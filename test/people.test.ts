import { createServer, type IncomingMessage } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseArgs } from '../src/capture/capture.ts';
import { definePlugin, mergeRegistries, type PluginApi, PluginError, resolvePlugins, resolvePluginsSync } from '../src/plugin/index.ts';
import { createApp } from '../src/server/app.ts';
import { identityResolver } from '../src/server/people.ts';
import { ReplayStore } from '../src/server/store.ts';
import { assertReplayPeople, parsePeopleFlags, parsePerson, personMatch, type ReplayPerson } from '../src/shared/people.ts';
import { assertReplayBundle, summarizeReplay } from '../src/shared/replay.ts';
import { suitePersonMatch } from '../src/shared/review-suite.ts';
import { appDefaults, replay } from './fixtures.ts';

const ROLES = ['pr-author', 'reviewer', 'requester', 'assignee', 'uploader', 'mentioned'];

const hooks = (request: IncomingMessage) => ({ request, webRequest: new Request('http://replays.test/') });

describe('meta.people: shape and size', () => {
  it('accepts up to ten people with an email or a handle each', () => {
    const people = [
      { role: 'reviewer', email: 'ada@example.com', name: 'Ada Lovelace', handles: { github: 'ada' } },
      { role: 'requester', handles: { chat: 'U123ABC' } },
    ];
    expect(() => assertReplayPeople(people)).not.toThrow();
    expect(() => assertReplayBundleWith(people)).not.toThrow();
    const many = Array.from({ length: 10 }, (_, index) => ({ role: 'mentioned', email: `p${index}@example.com` }));
    expect(() => assertReplayPeople(many)).not.toThrow();
  });

  it.each([
    [[{ role: 'reviewer' }], 'needs an email or a handle'],
    [[{ role: 'Reviewer', email: 'a@example.com' }], '.role'],
    [[{ role: 'reviewer', email: 'not an email' }], '.email'],
    [[{ role: 'reviewer', email: 'a@example.com', phone: '1' }], 'unsupported fields'],
    [[{ role: 'reviewer', handles: {} }], 'handles must name'],
    [[{ role: 'reviewer', handles: { GitHub: 'x' } }], 'handle id'],
    [[{ role: 'reviewer', handles: { github: 'has space' } }], 'without spaces'],
    [[{ role: 'reviewer', email: 'a@example.com', name: '' }], '.name'],
    [[{ role: 'reviewer', email: 'a@example.com', name: 'x'.repeat(81) }], '.name'],
    [Array.from({ length: 11 }, () => ({ role: 'mentioned', email: 'a@example.com' })), 'at most 10'],
    [
      Array.from({ length: 10 }, (_, index) => ({
        role: 'mentioned',
        name: 'n'.repeat(80),
        handles: Object.fromEntries(Array.from({ length: 5 }, (_unused, key) => [`h${key}`, `${index}`.repeat(90)])),
      })),
      'larger than 4096 bytes',
    ],
  ])('refuses %j', (people, message) => {
    expect(() => assertReplayPeople(people)).toThrow(message);
  });

  it('is part of the bundle check and the summary (stored fields only)', () => {
    expect(() => assertReplayBundleWith([{ role: 'reviewer' }])).toThrow('replay.meta.people[0] needs an email or a handle');
    const bundle = replay('with-people');
    bundle.meta.people = [{ role: 'reviewer', email: 'ada@example.com' }];
    expect(summarizeReplay(bundle).people).toEqual([{ role: 'reviewer', email: 'ada@example.com' }]);
    expect(summarizeReplay(replay('without')).people).toBeUndefined();
  });
});

function assertReplayBundleWith(people: unknown) {
  const bundle = replay('shape') as unknown as { meta: Record<string, unknown> };
  bundle.meta.people = people;
  assertReplayBundle(bundle);
}

describe('--person / ?person=', () => {
  it('parses role:email[:handle=value]…', () => {
    expect(parsePerson('reviewer:ada@example.com')).toEqual({ role: 'reviewer', email: 'ada@example.com' });
    expect(parsePerson('reviewer::github=octocat')).toEqual({ role: 'reviewer', handles: { github: 'octocat' } });
    expect(parsePerson('pr-author:ada@example.com:github=ada:chat=U1')).toEqual({
      role: 'pr-author',
      email: 'ada@example.com',
      handles: { github: 'ada', chat: 'U1' },
    });
  });

  it('names the flag and the value when it is wrong', () => {
    expect(() => parsePerson('reviewer')).toThrow('--person "reviewer" must look like role:email');
    expect(() => parsePerson('reviewer:')).toThrow('needs an email or a handle');
    expect(() => parsePerson('reviewer::github')).toThrow('must look like handle=value');
    expect(() =>
      parsePeopleFlags(
        Array.from({ length: 11 }, () => 'reviewer:a@example.com'),
        'person',
      ),
    ).toThrow('person can be given at most 10 times');
  });

  it('is a capture CLI flag', async () => {
    const args = await parseArgs([
      '--url',
      'https://example.com/',
      '--output',
      '/tmp/replays-people-test',
      '--person',
      'reviewer:ada@example.com',
      '--person',
      'requester::github=bob',
    ]);
    expect(args.people).toEqual([
      { role: 'reviewer', email: 'ada@example.com' },
      { role: 'requester', handles: { github: 'bob' } },
    ]);
    await expect(parseArgs(['--url', 'https://example.com/', '--output', '/tmp/x', '--person', 'bad'])).rejects.toThrow('--person');
  });
});

describe('personMatch', () => {
  const people: ReplayPerson[] = [
    { role: 'mentioned', email: 'ada@example.com' },
    { role: 'custom-role', email: 'ada@example.com' },
    { role: 'reviewer', handles: { github: 'Ada-L' } },
    { role: 'pr-author', email: 'bob@example.com' },
  ];

  it('reports the best-ranked matching role; unlisted roles rank last', () => {
    expect(personMatch(people, { email: 'ADA@example.com' }, ROLES)).toBe('mentioned');
    expect(personMatch(people, { email: 'ada@example.com', handles: { github: 'ada-l' } }, ROLES)).toBe('reviewer');
    expect(personMatch(people, { email: 'bob@example.com', handles: { github: 'ada-l' } }, ROLES)).toBe('pr-author');
    expect(personMatch([{ role: 'custom-role', email: 'ada@example.com' }], { email: 'ada@example.com' }, ROLES)).toBe('custom-role');
  });

  it('without roles, the first matching entry wins', () => {
    expect(personMatch(people, { email: 'ada@example.com', handles: { github: 'ada-l' } })).toBe('mentioned');
  });

  it('matches handles by id: the same value under another id is someone else', () => {
    expect(personMatch(people, { handles: { gitlab: 'ada-l' } }, ROLES)).toBeUndefined();
    expect(personMatch(people, {}, ROLES)).toBeUndefined();
    expect(personMatch(undefined, { email: 'ada@example.com' })).toBeUndefined();
  });

  it('a suite matches through its own people or any run replay', () => {
    const entry = {
      people: [{ role: 'mentioned', email: 'ada@example.com' }],
      runDetails: [{ replay: { people: [{ role: 'reviewer', email: 'ada@example.com' }] } }],
    } as unknown as Parameters<typeof suitePersonMatch>[0];
    expect(suitePersonMatch(entry, { email: 'ada@example.com' }, ROLES)).toBe('reviewer');
    expect(suitePersonMatch(entry, { email: 'eve@example.com' }, ROLES)).toBeUndefined();
  });
});

const plugin = (name: string, setup: (api: PluginApi) => void) => definePlugin({ name, setup });
const reviewersOnly = (api: PluginApi) => api.people({ roles: ['reviewer'] });
const fakeRequest = () => ({}) as never;
const personParam = (value: string) => `person=${encodeURIComponent(value)}`;

describe('api.people and api.identity registration', () => {
  it('one people registration per deployment', () => {
    const people = reviewersOnly;
    expect(() => resolvePluginsSync([plugin('a', people), plugin('b', people)])).toThrow(
      expect.objectContaining({ code: 'conflict', message: expect.stringContaining('already registered by a') }),
    );
    const a = resolvePluginsSync([plugin('a', people)]);
    const b = resolvePluginsSync([plugin('b', people)]);
    expect(() => mergeRegistries(a, b)).toThrow(PluginError);
  });

  it.each([
    [{ roles: [] }, 'non-empty'],
    [{ roles: ['Reviewer'] }, 'not a role'],
    [{ roles: ['a', 'a'] }, 'twice'],
    [{ handles: [{ id: 'github', label: 'GitHub', pattern: '(' }] }, 'does not compile'],
    [{ handles: [{ id: 'GitHub', label: 'GitHub', pattern: '.+' }] }, 'ids like'],
    [{ validate: 'no' }, 'must be a function'],
  ])('refuses people(%j)', (options, message) => {
    expect(() => resolvePluginsSync([plugin('a', (api) => api.people(options as never))])).toThrow(
      expect.objectContaining({ code: 'invalid-registration', message: expect.stringContaining(message) }),
    );
  });

  it('identity needs a resolve function', () => {
    expect(() => resolvePluginsSync([plugin('a', (api) => api.identity({} as never))])).toThrow('identity.resolve must be a function');
  });
});

describe('identity resolvers', () => {
  const request = fakeRequest;

  it('enrich name and avatar, in order, cached per request', async () => {
    const resolve = vi.fn<(identity: { id: string }) => { id: string; name: string; avatarUrl: string }>((identity) => ({
      ...identity,
      name: 'Ada Lovelace',
      avatarUrl: 'https://img.example.com/ada.png',
    }));
    const registry = await resolvePlugins([
      definePlugin({ name: 'directory', setup: (api) => api.identity({ resolve }) }),
      definePlugin({
        name: 'second',
        setup: (api) => api.identity({ resolve: async (identity) => ({ ...identity, name: `${identity.name}!` }) }),
      }),
    ]);
    const run = identityResolver(registry);
    const one = request();
    const first = await run({ id: 'ada', email: 'ada@example.com' }, hooks(one));
    expect(first).toEqual({ id: 'ada', email: 'ada@example.com', name: 'Ada Lovelace!', avatarUrl: 'https://img.example.com/ada.png' });
    expect(await run({ id: 'ada' }, hooks(one))).toBe(first);
    expect(resolve).toHaveBeenCalledTimes(1);
    await run({ id: 'ada' }, hooks(request()));
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("takes verified handles that fit the deployment's handles and merges them across resolvers", async () => {
    const registry = await resolvePlugins([
      definePlugin({
        name: 'people',
        setup: (api) => api.people({ handles: [{ id: 'github', label: 'GitHub username', pattern: '[a-z0-9-]{1,39}' }] }),
      }),
      definePlugin({
        name: 'one',
        setup: (api) => api.identity({ resolve: (identity) => ({ ...identity, handles: { github: 'ada', chat: 'U1' } }) }),
      }),
      definePlugin({
        name: 'two',
        setup: (api) => api.identity({ resolve: (identity) => ({ ...identity, handles: { github: 'not valid!' } }) }),
      }),
    ]);
    const result = await identityResolver(registry)({ id: 'ada' }, hooks(request()));
    expect(result.handles).toEqual({ github: 'ada' });
  });

  it('cannot change the id, and a failing or unsafe resolver changes nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registry = await resolvePlugins([
      definePlugin({ name: 'swap', setup: (api) => api.identity({ resolve: () => ({ id: 'admin', name: 'Someone else' }) }) }),
      definePlugin({
        name: 'broken',
        setup: (api) =>
          api.identity({
            resolve: () => {
              throw new Error('directory down');
            },
          }),
      }),
      definePlugin({
        name: 'unsafe',
        setup: (api) =>
          api.identity({ resolve: (identity) => ({ ...identity, avatarUrl: 'javascript:alert(1)', email: 'other@example.com' }) }),
      }),
    ]);
    const result = await identityResolver(registry)({ id: 'ada', email: 'ada@example.com' }, hooks(request()));
    expect(result).toEqual({ id: 'ada', email: 'ada@example.com' });
    expect(error.mock.calls.map((call) => String(call[0]))).toEqual([
      'plugin swap: identity.resolve failed:',
      'plugin broken: identity.resolve failed:',
    ]);
    expect(String(error.mock.calls[0]![1])).toContain('may not change');
    error.mockRestore();
  });
});

/* ---------- Through the app ---------- */

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
});

const peoplePlugin = definePlugin({
  name: 'people',
  setup(api) {
    api.people({
      roles: ROLES,
      validate: (person) => (person.email && !person.email.endsWith('@example.com') ? 'only example.com people' : undefined),
      handles: [{ id: 'github', label: 'GitHub username', pattern: '[a-z0-9-]{1,39}' }],
      avatarUrl: (person) =>
        person.handles?.github ? `https://avatars.example.com/${person.handles.github}.png` : 'http://insecure.example.com/a.png',
      profileUrl: (person, { sources }) =>
        person.handles?.github ? `https://github.example.com/${person.handles.github}?from=${sources.length}` : undefined,
    });
    api.identity({ resolve: (identity) => ({ ...identity, name: `Directory ${identity.id}` }) });
  },
});

async function start(plugins = [peoplePlugin]) {
  const root = await mkdtemp(join(tmpdir(), 'replays-people-'));
  await mkdir(join(root, 'client'), { recursive: true });
  await writeFile(join(root, 'client', 'index.html'), '<!doctype html><title>__PRODUCT_NAME__</title>');
  const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
  const handle = createApp({
    ...appDefaults(),
    auth: {
      name: 'token',
      authenticate: (request) => {
        const email = String(request.headers['x-email'] ?? 'ada@example.com');
        return { id: email, email };
      },
    },
    store,
    clientDir: join(root, 'client'),
    plugins: await resolvePlugins(plugins),
  });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const origin = `http://127.0.0.1:${address.port}`;
  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${origin}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { origin, store, send };
}

const withPeople = (id: string, people: ReplayPerson[]) => {
  const bundle = replay(id);
  bundle.meta.people = people;
  return bundle;
};

describe('people through the app', () => {
  it('refuses people the deployment does not accept, naming them', async () => {
    const { send } = await start();
    const cases: Array<[ReplayPerson, string]> = [
      [{ role: 'reviewer', email: 'eve@elsewhere.test' }, 'replay.meta.people[0] (reviewer eve@elsewhere.test): only example.com people'],
      [{ role: 'boss', email: 'ada@example.com' }, 'role must be one of pr-author, reviewer'],
      [{ role: 'reviewer', handles: { gitlab: 'ada' } }, 'unknown handle "gitlab"'],
      [{ role: 'reviewer', handles: { github: 'not_valid!' } }, 'is not a valid GitHub username'],
    ];
    for (const [person, message] of cases) {
      const response = await send('POST', '/api/replays', withPeople('refused', [person]));
      expect(response.status).toBe(400);
      expect(await response.text()).toContain(message);
    }
  });

  it('lists people with https avatar and profile links, and filters ?for=me with the best role as reason', async () => {
    const { send } = await start();
    const ada = { role: 'mentioned', email: 'ada@example.com' };
    expect((await send('POST', '/api/replays', withPeople('one', [ada, { role: 'reviewer', handles: { github: 'ada' } }]))).status).toBe(
      201,
    );
    expect((await send('POST', '/api/replays', withPeople('two', [{ role: 'requester', email: 'bob@example.com' }]))).status).toBe(201);
    expect((await send('POST', '/api/replays', replay('three'))).status).toBe(201);

    const all = (await (await send('GET', '/api/replays')).json()) as Array<{ id: string; people?: unknown[] }>;
    expect(all.find((summary) => summary.id === 'one')?.people).toEqual([
      ada,
      {
        role: 'reviewer',
        handles: { github: 'ada' },
        avatarUrl: 'https://avatars.example.com/ada.png',
        profileUrl: 'https://github.example.com/ada?from=0',
      },
    ]);

    const byEmail = (await (await send('GET', '/api/replays?for=me')).json()) as Array<{ id: string; reason: string }>;
    expect(byEmail.map(({ id, reason }) => [id, reason])).toEqual([['one', 'mentioned']]);
    const linked = (await (await send('GET', '/api/replays?for=me&handle.github=ADA')).json()) as Array<{ id: string; reason: string }>;
    expect(linked.map(({ id, reason }) => [id, reason])).toEqual([['one', 'reviewer']]);
    const bob = (await (await send('GET', '/api/replays?for=me', undefined, { 'x-email': 'bob@example.com' })).json()) as Array<{
      id: string;
    }>;
    expect(bob.map(({ id }) => id)).toEqual(['two']);

    const invalid = await send('GET', '/api/replays?for=me&handle.github=not_valid!');
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toContain('handle.github is not a valid GitHub username');
    expect((await send('GET', '/api/replays?for=me&handle.gitlab=ada')).status).toBe(400);
  });

  it("a resolver's verified handles count as the viewer's own: in For me and GET /api/me, and win over a linked claim", async () => {
    const directory = definePlugin({
      name: 'directory',
      setup(api) {
        api.identity({
          resolve: (identity) =>
            identity.email === 'ada@example.com'
              ? { ...identity, handles: { github: 'Ada', gitlab: 'ada', slack: 'not valid!' } }
              : undefined,
        });
      },
    });
    const { send } = await start([peoplePlugin, directory]);
    const byHandle = { role: 'pr-author', handles: { github: 'ada' } };
    expect((await send('POST', '/api/replays', withPeople('one', [byHandle]))).status).toBe(201);
    expect((await send('POST', '/api/replays', withPeople('two', [{ role: 'pr-author', handles: { github: 'eve' } }]))).status).toBe(201);

    const mine = (await (await send('GET', '/api/replays?for=me')).json()) as Array<{ id: string; reason: string }>;
    expect(mine.map(({ id, reason }) => [id, reason])).toEqual([['one', 'pr-author']]);
    const claimed = (await (await send('GET', '/api/replays?for=me&handle.github=eve')).json()) as Array<{ id: string }>;
    expect(claimed.map(({ id }) => id)).toEqual(['one']);
    const other = (await (await send('GET', '/api/replays?for=me', undefined, { 'x-email': 'bob@example.com' })).json()) as unknown[];
    expect(other).toEqual([]);
    const me = (await (await send('GET', '/api/me')).json()) as { handles?: unknown };
    expect(me.handles).toEqual({ github: 'Ada' });
  });

  it('GET /api/me: the resolved identity and the people config', async () => {
    const { send } = await start();
    expect(await (await send('GET', '/api/me')).json()).toEqual({
      id: 'ada@example.com',
      email: 'ada@example.com',
      name: 'Directory ada@example.com',
      people: { roles: ROLES, handles: [{ id: 'github', label: 'GitHub username', pattern: '[a-z0-9-]{1,39}' }] },
      session: { signedIn: true },
    });
  });

  it('suites: people are validated, a people-only re-registration replaces them, and ?for=me filters', async () => {
    const { send, store } = await start();
    const suite = { version: 1, id: 'suite-people', title: 'Checkout', createdAt: '2026-10-06T00:00:00.000Z' };
    expect(
      (await send('PUT', '/api/suites/suite-people', { ...suite, people: [{ role: 'reviewer', email: 'eve@elsewhere.test' }] })).status,
    ).toBe(400);
    expect(
      (await send('PUT', '/api/suites/suite-people', { ...suite, people: [{ role: 'mentioned', email: 'bob@example.com' }] })).status,
    ).toBe(200);
    // Absent keeps them; a different list replaces them; anything else that differs is still a conflict.
    expect((await send('PUT', '/api/suites/suite-people', suite)).status).toBe(200);
    expect((await store.loadSuite('suite-people'))?.people).toEqual([{ role: 'mentioned', email: 'bob@example.com' }]);
    const replaced = await send('PUT', '/api/suites/suite-people', { ...suite, people: [{ role: 'pr-author', email: 'ada@example.com' }] });
    expect(replaced.status).toBe(200);
    expect((await store.loadSuite('suite-people'))?.people).toEqual([{ role: 'pr-author', email: 'ada@example.com' }]);
    expect((await send('PUT', '/api/suites/suite-people', { ...suite, title: 'Renamed' })).status).toBe(409);

    const mine = (await (await send('GET', '/api/suites?for=me')).json()) as Array<{ id: string; reason: string; runDetails?: unknown }>;
    expect(mine.map(({ id, reason }) => [id, reason])).toEqual([['suite-people', 'pr-author']]);
    expect(mine[0]!.runDetails).toBeUndefined();
    const expanded = (await (await send('GET', '/api/suites?expand=runs&for=me')).json()) as Array<{ runDetails?: unknown }>;
    expect(expanded[0]!.runDetails).toEqual([]);
    expect(await (await send('GET', '/api/suites?for=me', undefined, { 'x-email': 'eve@example.com' })).json()).toEqual([]);
    const listed = (await (await send('GET', '/api/suites')).json()) as Array<{ people?: unknown }>;
    // The avatar callback answered an http URL for this person: dropped, never sent.
    expect(listed[0]!.people).toEqual([{ role: 'pr-author', email: 'ada@example.com' }]);
  });

  it('import takes ?person= (repeatable), checked like an upload', async () => {
    const { send, store } = await start();
    const rrweb = replay('import-source').events;
    const query = `title=Imported&url=${encodeURIComponent('https://example.com/')}`;
    const person = personParam;
    const ok = await send(
      'POST',
      `/api/replays/import?${query}&${person('reviewer:ada@example.com')}&${person('requester::github=bob')}`,
      rrweb,
    );
    expect(ok.status).toBe(201);
    const { id } = (await ok.json()) as { id: string };
    expect((await store.load(id))?.meta.people).toEqual([
      { role: 'reviewer', email: 'ada@example.com' },
      { role: 'requester', handles: { github: 'bob' } },
    ]);
    expect((await send('POST', `/api/replays/import?${query}&person=bad`, rrweb)).status).toBe(400);
    expect((await send('POST', `/api/replays/import?${query}&${person('boss:ada@example.com')}`, rrweb)).status).toBe(400);
  });

  it('without api.people, roles are free text and any handle is linked by shape only', async () => {
    const { send } = await start([]);
    expect(
      (await send('POST', '/api/replays', withPeople('free', [{ role: 'boss', email: 'eve@elsewhere.test', handles: { gitlab: 'Eve' } }])))
        .status,
    ).toBe(201);
    const mine = (await (await send('GET', '/api/replays?for=me&handle.gitlab=eve')).json()) as Array<{
      reason: string;
      people: unknown[];
    }>;
    expect(mine.map(({ reason }) => reason)).toEqual(['boss']);
    expect(mine[0]!.people).toEqual([{ role: 'boss', email: 'eve@elsewhere.test', handles: { gitlab: 'Eve' } }]);
    expect(await (await send('GET', '/api/me')).json()).toEqual({
      id: 'ada@example.com',
      email: 'ada@example.com',
      session: { signedIn: true },
    });
  });
});

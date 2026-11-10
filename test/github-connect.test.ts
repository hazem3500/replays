import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { definePlugin, type ReplaysPlugin, resolvePlugins } from '../src/plugin/index.ts';
import { createApp } from '../src/server/app.ts';
import { githubConnectFromEnv } from '../src/server/github-connect-config.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults, replay } from './fixtures.ts';

const servers: Array<ReturnType<typeof createServer>> = [];
function closeServersAfterEach() {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
  });
}

const SETTINGS = { clientId: 'Iv1.test-client', clientSecret: 'test-secret' };

interface GithubCall {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function configPlugins(send: (method: string, path: string) => Promise<Response>) {
  const config: unknown = await (await send('GET', '/api/config')).json();
  const plugins: unknown = isRecord(config) ? config.plugins : undefined;
  return Array.isArray(plugins) ? plugins.filter((name): name is string => typeof name === 'string') : [];
}

/** GitHub's two endpoints, answered locally: a code becomes a token, the token names `login`. */
function fakeGithub(login: string) {
  const calls: GithubCall[] = [];
  const fetchStub: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const sent: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body: isRecord(sent) ? sent : undefined });
    if (url.endsWith('/login/oauth/access_token'))
      return Promise.resolve(Response.json({ access_token: 'gho_token', token_type: 'bearer' }));
    if (url.endsWith('/user'))
      return Promise.resolve(Response.json({ login, avatar_url: `https://avatars.githubusercontent.com/u/1?v=4` }));
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  return { calls, fetchStub };
}

async function start(options: { configured?: boolean; login?: string; plugins?: ReplaysPlugin[] } = {}) {
  const { configured = true, login = 'octocat', plugins = [] } = options;
  const root = await mkdtemp(join(tmpdir(), 'replays-github-'));
  await mkdir(join(root, 'client'), { recursive: true });
  await writeFile(join(root, 'client', 'index.html'), '<!doctype html><title>__PRODUCT_NAME__</title>');
  const github = fakeGithub(login);
  const handle = createApp({
    ...appDefaults(),
    auth: {
      name: 'token',
      authenticate: (request) => {
        const email = String(request.headers['x-email'] ?? 'ada@example.com');
        return { id: email, email };
      },
    },
    store: new ReplayStore(join(root, 'data'), join(root, 'sample')),
    clientDir: join(root, 'client'),
    plugins: await resolvePlugins(plugins),
    ...(configured ? { githubConnect: { ...SETTINGS, fetch: github.fetchStub } } : {}),
    publicOrigin: 'https://replays.example.com',
  });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const origin = `http://127.0.0.1:${address.port}`;
  const send = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
    fetch(`${origin}${path}`, {
      method,
      redirect: 'manual',
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const begin = async (headers: Record<string, string> = {}, next = '/r/demo') => {
    const response = await send('GET', `/auth/github/start?next=${encodeURIComponent(next)}`, headers);
    const authorize = new URL(response.headers.get('location') ?? 'http://missing.test/');
    const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    return { response, authorize, cookie };
  };
  const connect = async (headers: Record<string, string> = {}, next = '/r/demo') => {
    const { authorize, cookie } = await begin(headers, next);
    return send('GET', `/auth/github/callback?code=abc&state=${authorize.searchParams.get('state')}`, { ...headers, cookie });
  };
  return { send, begin, connect, github };
}

describe('Connect GitHub setup', () => {
  closeServersAfterEach();

  it('is hidden when no OAuth app is configured: not in the plugin list, no routes, no flow', async () => {
    const { send, begin } = await start({ configured: false });
    expect((await configPlugins(send))).not.toContain('github-connect');
    expect((await send('GET', '/api/plugins/github-connect/link')).status).toBe(404);
    const flow = await begin();
    expect(flow.response.headers.get('location')).toBeNull();
    expect(flow.response.headers.get('set-cookie')).toBeNull();
  });

  it('needs both environment values, and none means off', () => {
    expect(githubConnectFromEnv({})).toBeUndefined();
    expect(githubConnectFromEnv({ REPLAYS_GITHUB_CLIENT_ID: ' id ', REPLAYS_GITHUB_CLIENT_SECRET: 's' })).toEqual({
      clientId: 'id',
      clientSecret: 's',
    });
    expect(() => githubConnectFromEnv({ REPLAYS_GITHUB_CLIENT_ID: 'id' })).toThrow(/REPLAYS_GITHUB_CLIENT_SECRET/);
  });

  it('sends the person to GitHub with a state, a PKCE challenge, our callback and no scopes', async () => {
    const { begin, send } = await start();
    expect(await configPlugins(send)).toContain('github-connect');
    const { response, authorize, cookie } = await begin();
    expect(response.status).toBe(302);
    expect(`${authorize.origin}${authorize.pathname}`).toBe('https://github.com/login/oauth/authorize');
    expect(authorize.searchParams.get('client_id')).toBe(SETTINGS.clientId);
    expect(authorize.searchParams.get('redirect_uri')).toBe('https://replays.example.com/auth/github/callback');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(authorize.searchParams.get('state')).toMatch(/^[\w-]{24}$/);
    expect(authorize.searchParams.has('scope')).toBe(false);
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Lax/);
    expect(cookie).toMatch(/^replays_github_oauth=/);
  });

});

describe('Connect GitHub callback', () => {
  closeServersAfterEach();

  it('refuses a callback whose state does not match, and stores nothing', async () => {
    const { begin, send, github } = await start();
    const { cookie } = await begin();
    const wrong = await send('GET', '/auth/github/callback?code=abc&state=not-the-state', { cookie });
    expect(wrong.status).toBe(400);
    const noCookie = await send('GET', '/auth/github/callback?code=abc&state=anything');
    expect(noCookie.status).toBe(400);
    expect(github.calls).toEqual([]);
    expect(await (await send('GET', '/api/plugins/github-connect/link')).json()).toMatchObject({ available: true, linked: null });
  });

  it("refuses another person's callback with the right state", async () => {
    const { begin, send, github } = await start();
    const { authorize, cookie } = await begin({ 'x-email': 'ada@example.com' });
    const stolen = await send('GET', `/auth/github/callback?code=abc&state=${authorize.searchParams.get('state')}`, {
      cookie,
      'x-email': 'eve@example.com',
    });
    expect(stolen.status).toBe(400);
    expect(github.calls).toEqual([]);
  });

  it('stores the verified login for the email, revokes the token, and /api/me and For me count it as verified', async () => {
    const { connect, send, github } = await start();
    const bundle = replay('shipped');
    bundle.meta.people = [{ role: 'reviewer', handles: { github: 'Octocat' } }];
    expect((await send('POST', '/api/replays', {}, bundle)).status).toBe(201);
    expect((await send('POST', '/api/replays', {}, replay('other'))).status).toBe(201);

    const done = await connect();
    expect(done.status).toBe(302);
    expect(done.headers.get('location')).toBe('/r/demo');
    expect(done.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect(github.calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'POST https://github.com/login/oauth/access_token',
      'GET https://api.github.com/user',
      `DELETE https://api.github.com/applications/${SETTINGS.clientId}/token`,
    ]);
    expect(github.calls[0]?.body).toMatchObject({
      code: 'abc',
      client_id: SETTINGS.clientId,
      redirect_uri: 'https://replays.example.com/auth/github/callback',
    });
    expect(github.calls[0]?.body?.code_verifier).toMatch(/^[\w-]{43}$/);
    expect(github.calls[2]?.body).toEqual({ access_token: 'gho_token' });

    expect(await (await send('GET', '/api/me')).json()).toMatchObject({
      handles: { github: 'octocat' },
      avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
    });
    expect(await (await send('GET', '/api/plugins/github-connect/link')).json()).toEqual({
      available: true,
      linked: { login: 'octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4' },
    });
    expect(await (await send('GET', '/api/replays?for=me')).json()).toMatchObject([{ id: 'shipped', reason: 'reviewer' }]);
    expect(await (await send('GET', '/api/me', { 'x-email': 'bob@example.com' })).json()).not.toHaveProperty('handles');
  });

  it('returns only to a path inside the app', async () => {
    const { connect } = await start();
    expect((await connect({}, '//evil.example.com/x')).headers.get('location')).toBe('/');
    expect((await connect({}, 'https://evil.example.com/')).headers.get('location')).toBe('/');
  });

  it('answers a GitHub failure without storing a link', async () => {
    const { begin, send } = await start({ login: 'not a login!' });
    const { authorize, cookie } = await begin();
    const failed = await send('GET', `/auth/github/callback?code=abc&state=${authorize.searchParams.get('state')}`, { cookie });
    expect(failed.status).toBe(502);
    expect(await (await send('GET', '/api/plugins/github-connect/link')).json()).toMatchObject({ linked: null });
  });
});

describe('Connect GitHub link', () => {
  closeServersAfterEach();

  it('disconnects: the handle and avatar go, and Connect is offered again', async () => {
    const { connect, send } = await start();
    await connect();
    const removed = await send('DELETE', '/api/plugins/github-connect/link');
    expect(removed.status).toBe(204);
    const me: unknown = await (await send('GET', '/api/me')).json();
    expect(me).not.toHaveProperty('handles');
    expect(me).not.toHaveProperty('avatarUrl');
    expect(await (await send('GET', '/api/plugins/github-connect/link')).json()).toEqual({ available: true, linked: null });
  });

  it('offers nothing to a person the host already vouches a GitHub login for', async () => {
    const roster = definePlugin({
      name: 'roster',
      setup(api) {
        api.identity({
          resolve: (identity) =>
            identity.email === 'ada@example.com' ? { ...identity, handles: { github: 'ada-from-roster' } } : undefined,
        });
      },
    });
    const { send } = await start({ plugins: [roster] });
    expect(await (await send('GET', '/api/plugins/github-connect/link')).json()).toEqual({ available: false, linked: null });
    expect(await (await send('GET', '/api/plugins/github-connect/link', { 'x-email': 'bob@example.com' })).json()).toMatchObject({
      available: true,
    });
  });

  it('offers nothing when the deployment’s people handles leave GitHub out', async () => {
    const people = definePlugin({
      name: 'people',
      setup(api) {
        api.people({ handles: [{ id: 'slack', label: 'Slack', pattern: '[a-z0-9]+' }] });
      },
    });
    const { send } = await start({ plugins: [people] });
    expect(await (await send('GET', '/api/plugins/github-connect/link')).json()).toMatchObject({ available: false });
  });
});

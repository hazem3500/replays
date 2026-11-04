import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadCaptureRedaction } from '../src/capture/capture.ts';
import { networkEntries, sanitizeHar, sanitizeReplayBundle } from '../src/capture/sanitize.ts';
import { type CdpLike, normalizeConsole, recorderScript, RecorderSession } from '../src/capture/session.ts';
import { definePlugin, mergeRegistries, PluginError, resolvePlugins, resolvePluginsSync } from '../src/plugin/index.ts';
import { createApp } from '../src/server/app.ts';
import { loadSettings, readConfigFile } from '../src/server/config.ts';
import { ReplayStore } from '../src/server/store.ts';
import {
  assertRedactionRules,
  compileRedaction,
  MAX_REDACTION_PATTERN_LENGTH,
  MAX_REDACTION_RULES,
  mergeRedactionRules,
  type RedactionRules,
  redactJsonKeys,
} from '../src/shared/redaction.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import { appDefaults, replay } from './fixtures.ts';

const RULES: RedactionRules = {
  headers: [/^x-acme-session$/i],
  queryParams: ['invite_token'],
  jsonKeys: ['ssn', /card_?number/i],
  text: [{ pattern: /\bACME-\d{6}\b/g, replace: '[ticket]' }],
  maskSelectors: ['[data-private]'],
};

/** The same rules as a JSON config writes them. */
const JSON_RULES = {
  headers: ['/^x-acme-session$/i'],
  queryParams: ['invite_token'],
  jsonKeys: ['ssn', '/card_?number/i'],
  text: [{ pattern: '/\\bACME-\\d{6}\\b/g', replace: '[ticket]' }],
  maskSelectors: ['[data-private]'],
};

const field = (id: number, tagName: string, attributes: Record<string, string>, childNodes: unknown[] = []) => ({
  type: 2,
  id,
  tagName,
  attributes,
  childNodes,
});

const snapshot = (privateText: string, publicText: string) => ({
  type: 2,
  timestamp: 1001,
  data: {
    node: {
      type: 2,
      id: 1,
      tagName: 'main',
      attributes: {},
      childNodes: [
        { type: 2, id: 2, tagName: 'p', attributes: { 'data-private': '' }, childNodes: [{ type: 3, id: 3, textContent: privateText }] },
        { type: 2, id: 4, tagName: 'p', attributes: {}, childNodes: [{ type: 3, id: 5, textContent: publicText }] },
      ],
    },
  },
});

const leaky = (): ReplayBundle => {
  const bundle = replay('redaction-rules');
  bundle.meta.title = 'Checkout for ACME-123456';
  bundle.events = [
    { type: 4, timestamp: 1000, data: { href: 'https://app.example.com/join?invite_token=invite-secret' } },
    snapshot('Jane Doe, 1 Main St', 'Ticket ACME-654321'),
    {
      type: 3,
      timestamp: 1002,
      data: {
        source: 0,
        adds: [{ parentId: 2, node: { type: 3, id: 6, textContent: 'added private' } }],
        texts: [
          { id: 3, value: 'changed private' },
          { id: 5, value: 'changed public' },
        ],
        attributes: [],
        removes: [],
      },
    },
  ] as ReplayBundle['events'];
  bundle.console = [
    { at: 0, level: 'log', message: '{"user":{"ssn":"123-45-6789","cardNumber":4111111111111111,"name":"Jane"}} ACME-111111' },
  ];
  bundle.steps = [{ at: 0, kind: 'click', label: 'Open ACME-222222' }];
  bundle.network = [
    {
      id: 'request-1',
      at: 0,
      duration: 1,
      method: 'GET',
      url: 'https://api.example.com/invites?invite_token=invite-secret&view=all',
      status: 200,
      statusText: 'OK',
      requestHeaders: [
        { name: 'X-Acme-Session', value: 'session-secret' },
        { name: 'Accept', value: 'application/json' },
      ],
      responseHeaders: [{ name: 'X-Ticket', value: 'ACME-333333' }],
    },
  ];
  return bundle;
};

describe('assertRedactionRules', () => {
  it('accepts RegExps, literal names and "/.../flags" strings', () => {
    expect(() => assertRedactionRules(RULES)).not.toThrow();
    expect(() => assertRedactionRules(JSON_RULES)).not.toThrow();
    expect(() => assertRedactionRules({})).not.toThrow();
  });

  it.each([
    [[], /must be an object/],
    [{ headers: 'x-a' }, /redaction.headers must be an array/],
    [{ headers: [''] }, /headers\[0\] must be a non-empty string or a RegExp/],
    [{ jsonKeys: [42] }, /jsonKeys\[0\]/],
    [{ queryParams: ['/(unclosed/'] }, /not a valid regular expression/],
    [{ text: [{ pattern: 'x'.repeat(MAX_REDACTION_PATTERN_LENGTH + 1) }] }, /longer than 200 characters/],
    [{ headers: [new RegExp('a'.repeat(MAX_REDACTION_PATTERN_LENGTH + 1))] }, /longer than 200/],
    [{ jsonKeys: Array.from({ length: MAX_REDACTION_RULES + 1 }, (_, index) => `k${index}`) }, /at most 100 entries/],
    [{ text: [{ pattern: /a*/ }] }, /must not match the empty string/],
    [{ text: [{ pattern: /\d+/, replace: '0' }] }, /must not match its own pattern/],
    [{ text: [{ pattern: /x/, flags: 'g' }] }, /unknown keys: flags/],
    [{ text: ['ACME'] }, /must be \{ pattern, replace\? \}/],
    [{ maskSelectors: [' '] }, /non-empty CSS selector/],
  ])('refuses %j', (rules, message) => {
    expect(() => assertRedactionRules(rules)).toThrow(message);
  });

  it('merges rule sets by concatenating their lists', () => {
    expect(mergeRedactionRules({ jsonKeys: ['a'] }, undefined, { jsonKeys: [/b/], maskSelectors: ['.x'] })).toEqual({
      jsonKeys: ['a', /b/],
      maskSelectors: ['.x'],
    });
  });

  it('matches names exactly and case-insensitively, patterns by test, without regex state between calls', () => {
    const rules = compileRedaction({ jsonKeys: ['SSN', /^card/g] });
    expect([rules.jsonKey('ssn'), rules.jsonKey('ssn_last4'), rules.jsonKey('cardNumber'), rules.jsonKey('cardNumber')]).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });
});

describe('redactJsonKeys', () => {
  const rules = compileRedaction({ jsonKeys: ['ssn', 'card', 'token'] });
  it('replaces strings, numbers, objects and arrays, nested or embedded in a message', () => {
    expect(redactJsonKeys('{"ssn":"1","n":2,"card":{"no":4111,"exp":[1,2]},"list":[{"token":null}]}', rules)).toBe(
      '{"ssn":"[redacted]","n":2,"card":"[redacted]","list":[{"token":"[redacted]"}]}',
    );
    expect(redactJsonKeys('saved {"ssn": "1\\"2", "ok": true} done', rules)).toBe('saved {"ssn": "[redacted]", "ok": true} done');
    expect(redactJsonKeys('no json ssn: 1', rules)).toBe('no json ssn: 1');
  });
});

describe('server privacy pass with rules', () => {
  const clean = sanitizeReplayBundle(leaky(), RULES);
  const text = JSON.stringify(clean);

  it('drops extra headers and redacts extra query parameters', () => {
    expect(clean.network[0]!.requestHeaders).toEqual([{ name: 'Accept', value: 'application/json' }]);
    expect(clean.network[0]!.url).toBe('https://api.example.com/invites?invite_token=%5Bredacted%5D&view=all');
    expect(text).not.toContain('invite-secret');
    expect(text).not.toContain('session-secret');
  });

  it('redacts JSON keys in console messages', () => {
    expect(clean.console[0]!.message).toBe('{"user":{"ssn":"[redacted]","cardNumber":"[redacted]","name":"Jane"}} [ticket]');
  });

  it('replaces text in the title, step labels, DOM text, console, header values', () => {
    expect(clean.meta.title).toBe('Checkout for [ticket]');
    expect(clean.steps[0]!.label).toBe('Open [ticket]');
    expect(clean.network[0]!.responseHeaders).toEqual([{ name: 'X-Ticket', value: '[ticket]' }]);
    expect(text).not.toMatch(/ACME-\d{6}/);
  });

  it('masks text under mask selectors in snapshots, added nodes and text changes, and nothing else', () => {
    const node = (clean.events[1] as unknown as { data: { node: { childNodes: Array<{ childNodes: Array<{ textContent: string }> }> } } })
      .data.node;
    expect(node.childNodes[0]!.childNodes[0]!.textContent).toBe('**** **** * **** **');
    expect(node.childNodes[1]!.childNodes[0]!.textContent).toBe('Ticket [ticket]');
    const mutation = (
      clean.events[2] as unknown as { data: { adds: Array<{ node: { textContent: string } }>; texts: Array<{ value: string }> } }
    ).data;
    expect(mutation.adds[0]!.node.textContent).toBe('***** *******');
    expect(mutation.texts.map((change) => change.value)).toEqual(['******* *******', 'changed public']);
  });

  it('is idempotent with rules, and JSON-config rules do the same as RegExp rules', () => {
    expect(sanitizeReplayBundle(structuredClone(clean), RULES)).toEqual(clean);
    expect(sanitizeReplayBundle(leaky(), JSON_RULES as RedactionRules)).toEqual(clean);
  });

  it('applies text rules and mask selectors to input values kept visible', () => {
    const bundle = replay();
    bundle.meta.captured = { console: false, network: 'off', performance: false, video: false, inputs: 'visible' };
    const node = field(1, 'form', {}, [
      field(2, 'input', { type: 'text', value: 'order ACME-123456' }),
      field(3, 'textarea', { 'data-private': '' }, [{ type: 3, id: 4, textContent: 'private note' }]),
    ]);
    bundle.events = [{ type: 2, timestamp: 1, data: { node } }] as ReplayBundle['events'];
    const serialized = JSON.stringify(sanitizeReplayBundle(bundle, RULES, { keepVisibleInputs: true }));
    expect(serialized).toContain('order [ticket]');
    expect(serialized).toContain('"textContent":"******* ****"');
  });

  it('checks only the last compound of a complex selector, so it masks as much or more', () => {
    const masked = sanitizeReplayBundle(
      { ...replay(), events: [snapshot('a b', 'c')] as ReplayBundle['events'] },
      {
        maskSelectors: ['.card > p[data-private]:not(.public), #missing'],
      },
    );
    const node = (masked.events[0] as unknown as { data: { node: { childNodes: Array<{ childNodes: Array<{ textContent: string }> }> } } })
      .data.node;
    expect(node.childNodes.map((child) => child.childNodes[0]!.textContent)).toEqual(['* *', 'c']);
  });
});

describe('capture path with rules', () => {
  it('normalizeConsole applies JSON keys, text and query parameters', () => {
    const [entry] = normalizeConsole(
      [
        {
          at: 10,
          level: 'log',
          message: '{"ssn":"1"} ACME-123456 https://x.example/?invite_token=abc',
          url: 'https://x.example/?invite_token=abc',
        },
      ],
      0,
      RULES,
    );
    expect(entry).toEqual({
      at: 10,
      level: 'log',
      message: '{"ssn":"[redacted]"} [ticket] https://x.example/?invite_token=%5Bredacted%5D',
      url: 'https://x.example/?invite_token=%5Bredacted%5D',
    });
  });

  it('networkEntries and sanitizeHar drop extra headers, query and form parameters', () => {
    const har = {
      log: {
        entries: [
          {
            startedDateTime: '2026-10-06T00:00:01.000Z',
            request: {
              method: 'POST',
              url: 'https://x.example/?invite_token=abc',
              headers: [{ name: 'X-Acme-Session', value: 's' }],
              postData: {
                params: [
                  { name: 'ssn', value: '1' },
                  { name: 'invite_token', value: '2' },
                  { name: 'q', value: '3' },
                ],
              },
            },
            response: { status: 200, headers: [{ name: 'x-acme-session', value: 's' }] },
          },
        ],
      },
    };
    const [entry] = networkEntries(har, Date.parse('2026-10-06T00:00:00.000Z'), RULES);
    expect(entry).toMatchObject({ url: 'https://x.example/?invite_token=%5Bredacted%5D', requestHeaders: [], responseHeaders: [] });
    expect(sanitizeHar(har, RULES).log!.entries![0]!.request!.postData!.params).toEqual([
      { name: 'ssn', value: '[redacted]' },
      { name: 'invite_token', value: '[redacted]' },
      { name: 'q', value: '3' },
    ]);
  });

  it('hands mask selectors to the recorder as a string literal before the page script', () => {
    expect(recorderScript('/*recorder*/')).toBe('/*recorder*/');
    expect(recorderScript('/*recorder*/', { maskSelectors: ['[data-private]', '.pii'] })).toBe(
      'window.__REPLAYS_MASK_TEXT__="[data-private], .pii";\n/*recorder*/',
    );
  });

  it('RecorderSession injects the selectors and redacts events and console as they arrive', async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const chunks = [
      {
        events: [{ type: 4, timestamp: 1000, data: { href: 'https://x.example/?invite_token=abc' } }, snapshot('private', 'ACME-123456')],
        console: [{ at: 1000, level: 'log', message: '{"cardNumber":1}' }],
      },
    ];
    const cdp: CdpLike = {
      async send(method, params) {
        calls.push({ method, ...(params ? { params } : {}) });
        if (method === 'Runtime.evaluate') return { result: { value: chunks.shift() } };
        return {};
      },
      on() {},
      off() {},
    };
    const session = await RecorderSession.start(cdp, { pullIntervalMs: 60_000, redaction: RULES });
    const script = String(calls.find((call) => call.method === 'Page.addScriptToEvaluateOnNewDocument')?.params?.source);
    expect(script.startsWith('window.__REPLAYS_MASK_TEXT__="[data-private]";\n')).toBe(true);
    const tracks = await session.stop();
    const text = JSON.stringify(tracks.events);
    expect(text).toContain('invite_token=%5Bredacted%5D');
    expect(text).toContain('[ticket]');
    expect(text).not.toContain('"textContent":"private"');
    expect(tracks.console[0]!.message).toBe('{"cardNumber":"[redacted]"}');
  });

  it('the recorder passes the selectors to rrweb and refuses an invalid one', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../src/capture/injected-recorder.ts', import.meta.url), 'utf8');
    expect(source).toContain('maskTextSelector');
    expect(source).toContain('querySelector(maskTextSelector)');
  });
});

describe('loading rules for the capture CLI', () => {
  it('reads the config file and every plugin, from cwd discovery or --config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'replays-redaction-config-'));
    await writeFile(
      join(dir, 'plugin.mjs'),
      `export default { name: 'acme-redaction', apiVersion: 1, setup(api) { api.redaction({ headers: ['x-acme'], text: [{ pattern: /ACME-\\d+/g }] }); } };\n`,
    );
    await writeFile(join(dir, 'replays.config.json'), JSON.stringify({ redaction: { jsonKeys: ['/ssn/i'] }, plugins: ['./plugin.mjs'] }));
    const discovered = await loadCaptureRedaction({ cwd: dir, env: {} });
    expect(discovered).toEqual({ headers: ['x-acme'], jsonKeys: ['/ssn/i'], text: [{ pattern: /ACME-\d+/g }] });
    const elsewhere = await mkdtemp(join(tmpdir(), 'replays-redaction-cwd-'));
    expect(await loadCaptureRedaction({ cwd: elsewhere, env: {} })).toBeUndefined();
    expect(await loadCaptureRedaction({ cwd: elsewhere, env: {}, configFile: join(dir, 'replays.config.json') })).toEqual(discovered);
  });

  it('fails the capture on a bad config rather than capturing without rules', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'replays-redaction-bad-'));
    await writeFile(join(dir, 'replays.config.json'), JSON.stringify({ redaction: { jsonKeys: ['/(/'] } }));
    await expect(loadCaptureRedaction({ cwd: dir, env: {} })).rejects.toThrow(/not a valid regular expression/);
  });
});

describe('api.redaction and the config key', () => {
  it('merges rules from several plugins, in plugin order, and across registries', async () => {
    const a = definePlugin({ name: 'a', setup: (api) => api.redaction({ jsonKeys: ['ssn'] }) });
    const b = definePlugin({
      name: 'b',
      setup(api) {
        api.redaction({ jsonKeys: [/card/i], maskSelectors: ['.pii'] });
        api.redaction({ queryParams: ['invite_token'] });
      },
    });
    const registry = await resolvePlugins([a, b]);
    expect(registry.redaction).toEqual({ queryParams: ['invite_token'], jsonKeys: ['ssn', /card/i], maskSelectors: ['.pii'] });
    const other = resolvePluginsSync([definePlugin({ name: 'c', setup: (api) => api.redaction({ headers: ['x-c'] }) })]);
    expect(mergeRegistries(registry, other).redaction).toMatchObject({ headers: ['x-c'], jsonKeys: ['ssn', /card/i] });
  });

  it('refuses bad rules at start with the plugin named', async () => {
    const bad = definePlugin({ name: 'bad', setup: (api) => api.redaction({ text: [{ pattern: /.*/ }] }) });
    const error = await resolvePlugins([bad]).catch((caught: unknown) => caught as PluginError);
    expect(error).toBeInstanceOf(PluginError);
    expect(error).toMatchObject({ code: 'invalid-registration', plugin: 'bad' });
    expect((error as Error).message).toMatch(/must not match the empty string/);
  });

  it('has no key that keeps visible inputs, so a plugin cannot turn masking off', () => {
    expect(() => assertRedactionRules({ keepVisibleInputs: true })).toThrow(/unknown keys: keepVisibleInputs/);
  });

  it('is a config key, checked when the settings load', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'replays-redaction-settings-'));
    await writeFile(join(dir, 'config.json'), JSON.stringify({ redaction: JSON_RULES }));
    const file = await readConfigFile(join(dir, 'config.json'));
    expect((await loadSettings({}, file, dir)).redaction).toEqual(JSON_RULES);
    await expect(loadSettings({}, { redaction: { headers: 'x' } as unknown as RedactionRules }, dir)).rejects.toThrow(
      /config redaction.headers must be an array/,
    );
  });
});

describe('upload with config and plugin rules', () => {
  const servers: Array<ReturnType<typeof createServer>> = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
  });

  it('the stored bundle has both rule sets applied, whatever the producer sent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-redaction-app-'));
    await mkdir(join(root, 'client'), { recursive: true });
    await writeFile(join(root, 'client', 'index.html'), '<!doctype html><title>__PRODUCT_NAME__</title>');
    const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
    const plugins = await resolvePlugins([
      definePlugin({
        name: 'acme',
        setup: (api) => api.redaction({ headers: RULES.headers!, text: RULES.text!, maskSelectors: RULES.maskSelectors! }),
      }),
    ]);
    const handle = createApp({
      ...appDefaults(),
      store,
      clientDir: join(root, 'client'),
      plugins,
      redaction: { queryParams: JSON_RULES.queryParams, jsonKeys: JSON_RULES.jsonKeys },
    });
    const server = createServer((request, response) => void handle(request, response));
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${port}/api/replays`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(leaky()),
    });
    expect(response.status).toBe(201);
    expect(await store.load('redaction-rules')).toEqual(sanitizeReplayBundle(leaky(), RULES));
  });
});

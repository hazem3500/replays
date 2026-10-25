import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { redactEvents, sanitizeReplayBundle } from '../src/capture/sanitize.ts';
import { normalizeConsole } from '../src/capture/session.ts';
import { definePlugin, mergeRegistries, resolvePluginsSync } from '../src/plugin/index.ts';
import { createApp } from '../src/server/app.ts';
import { MemoryStorage } from '../src/server/storage/memory.ts';
import { ReplayStore } from '../src/server/store.ts';
import { compileRedaction, mergeRedactionRules, type RedactionRules, redactText } from '../src/shared/redaction.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import { appDefaults, replay } from './fixtures.ts';

const text = (id: number, textContent: string) => ({ type: 3, id, textContent });
const element = (id: number, attributes: Record<string, unknown>, childNodes: unknown[] = []) => ({
  type: 2,
  id,
  tagName: 'div',
  attributes,
  childNodes,
});
const snapshot = (node: unknown) => ({ type: 2, timestamp: 1, data: { node } });
const mutation = (data: Record<string, unknown>) => ({ type: 3, timestamp: 2, data: { source: 0, ...data } });
const redact = <T>(events: T, maskSelectors = ['.private']) => redactEvents(structuredClone(events), { maskSelectors });

describe('selector privacy through DOM mutations', () => {
  it('masks an existing descendant when its ancestor becomes private, including later text and additions', () => {
    const events = [
      snapshot(element(1, {}, [element(2, { class: 'public' }, [element(3, {}, [text(4, 'earlier text')])]), text(5, 'public')])),
      mutation({ attributes: [{ id: 2, attributes: { class: 'private' } }], texts: [{ id: 4, value: 'sensitive text' }] }),
      mutation({
        adds: [{ parentId: 3, node: text(6, 'added secret') }],
        texts: [
          { id: 4, value: 'future secret' },
          { id: 5, value: 'still public' },
        ],
      }),
    ];
    const clean = redact(events);
    expect(clean[1]!.data).toMatchObject({ texts: [{ id: 4, value: '********* ****' }] });
    expect(clean[2]!.data).toMatchObject({
      adds: [{ node: { textContent: '***** ******' } }],
      texts: [
        { id: 4, value: '****** ******' },
        { id: 5, value: 'still public' },
      ],
    });
    expect(redact(clean)).toEqual(clean);
    expect(events[1]!.data).toMatchObject({ texts: [{ value: 'sensitive text' }] });
  });

  it('keeps accumulated attributes for compound selectors without rewriting historical attributes', () => {
    const events = [
      snapshot(element(1, { class: 'target' }, [text(2, 'earlier')])),
      mutation({ attributes: [{ id: 1, attributes: { title: 'private' } }] }),
      mutation({ attributes: [{ id: 1, attributes: { 'data-private': '' } }], texts: [{ id: 2, value: 'secret' }] }),
      mutation({ attributes: [{ id: 1, attributes: { class: null, 'data-private': null } }], texts: [{ id: 2, value: 'future' }] }),
    ];
    const clean = redact(events, ['.target[title="private"][data-private]']);
    expect(clean[0]!.data).toMatchObject({ node: { attributes: { class: 'target' } } });
    expect((clean[0]!.data as { node: { attributes: unknown } }).node.attributes).toEqual({ class: 'target' });
    expect(clean[2]!.data).toMatchObject({ texts: [{ value: '******' }] });
    expect(clean[3]!.data).toMatchObject({ texts: [{ value: '******' }] });
  });

  it('protects a moved subtree and its later text even when the move omits serialized children', () => {
    const events = [
      snapshot(element(1, {}, [element(2, { class: 'private' }), element(3, {}, [text(4, 'public before move')])])),
      mutation({
        removes: [{ parentId: 1, id: 3 }],
        adds: [{ parentId: 2, node: { type: 2, id: 3, tagName: 'div', attributes: {} } }],
        texts: [{ id: 4, value: 'moved secret' }],
      }),
    ];
    expect(redact(events)[1]!.data).toMatchObject({ texts: [{ value: '***** ******' }] });
  });

  it('links out-of-order added descendants before applying a private attribute transition', () => {
    const events = [
      snapshot(element(1, {})),
      mutation({
        adds: [
          { parentId: 2, node: text(3, 'new secret') },
          { parentId: 1, node: element(2, {}) },
        ],
        attributes: [{ id: 2, attributes: { class: 'private' } }],
      }),
      mutation({ texts: [{ id: 3, value: 'later secret' }] }),
    ];
    const clean = redact(events);
    expect(clean[1]!.data).toMatchObject({ adds: [{ node: { textContent: '*** ******' } }, {}] });
    expect(clean[2]!.data).toMatchObject({ texts: [{ value: '***** ******' }] });
  });

  it('does not inherit privacy from an old ancestor after a public subtree moved elsewhere', () => {
    const events = [
      snapshot(element(1, {}, [element(2, {}, [element(3, {}, [text(4, 'public')])]), element(5, {})])),
      mutation({ removes: [{ parentId: 2, id: 3 }], adds: [{ parentId: 5, node: element(3, {}, [text(4, 'public')]) }] }),
      mutation({ attributes: [{ id: 2, attributes: { class: 'private' } }], texts: [{ id: 4, value: 'still public' }] }),
    ];
    expect(redact(events)[2]!.data).toMatchObject({ texts: [{ value: 'still public' }] });
  });

  it('resets ancestry and privacy on a new full snapshot that reuses node IDs', () => {
    const events = [
      snapshot(element(1, { class: 'private' }, [text(2, 'old secret')])),
      snapshot(element(1, {}, [text(2, 'new public')])),
      mutation({ texts: [{ id: 2, value: 'still public' }] }),
    ];
    const clean = redact(events);
    expect(clean[1]!.data).toMatchObject({ node: { childNodes: [{ textContent: 'new public' }] } });
    expect(clean[2]!.data).toMatchObject({ texts: [{ value: 'still public' }] });
  });

  it('applies the same mutation protections to uploaded bundles', () => {
    const bundle = replay('private-transition');
    bundle.events = [
      snapshot(element(1, {}, [text(2, 'initial')])),
      mutation({ attributes: [{ id: 1, attributes: { class: 'private' } }], texts: [{ id: 2, value: 'uploaded secret' }] }),
    ] as ReplayBundle['events'];
    const rules = { maskSelectors: ['.private'] };
    const clean = sanitizeReplayBundle(bundle, rules);
    expect(JSON.stringify(clean.events)).not.toContain('uploaded secret');
    expect(sanitizeReplayBundle(clean, rules)).toEqual(clean);
  });
});

const registry = (name: string, redaction: RedactionRules) =>
  resolvePluginsSync([definePlugin({ name, setup: (api) => api.redaction(redaction) })]);

describe('stable text redaction across merged rules', () => {
  const earlier = registry('earlier', { text: [{ pattern: 'bar', replace: 'baz' }] });
  const later = registry('later', { text: [{ pattern: 'foo', replace: 'bar' }] });
  const rules = mergeRegistries(earlier, later).redaction;

  it('settles replacements from separate plugins before returning, on both capture and upload', () => {
    const bundle = replay('merged-text');
    bundle.meta.title = 'foo';
    bundle.console = [{ at: 0, level: 'log', message: 'foo' }];
    const clean = sanitizeReplayBundle(bundle, rules);
    expect(clean.meta.title).toBe('baz');
    expect(clean.console[0]!.message).toBe('baz');
    expect(sanitizeReplayBundle(clean, rules)).toEqual(clean);
    expect(normalizeConsole([{ at: 0, level: 'log', message: 'foo' }], 0, rules)).toEqual(clean.console);
  });

  it('settles a single rule whose replacement exposes another match at its boundary', () => {
    const compiled = compileRedaction({ text: [{ pattern: 'aa', replace: 'a' }] });
    const clean = redactText('aaaaaaa', compiled);
    expect(clean).toBe('a');
    expect(redactText(clean, compiled)).toBe(clean);
  });

  it('keeps selector masks stable when text rules can rewrite the masking characters', () => {
    const bundle = replay('text-and-selectors');
    bundle.events = [snapshot(element(1, { class: 'private' }, [text(2, '12345')]))] as ReplayBundle['events'];
    const combined = mergeRedactionRules({ maskSelectors: ['.private'] }, { text: [{ pattern: '**', replace: 'x' }] });
    const clean = sanitizeReplayBundle(bundle, combined);
    expect(JSON.stringify(clean.events)).not.toContain('12345');
    expect(sanitizeReplayBundle(clean, combined)).toEqual(clean);
    const captured = redactEvents(bundle.events, combined);
    expect(redactEvents(captured, combined)).toEqual(captured);
    expect(captured).toEqual(clean.events);
  });

  it('redacts JSON keys introduced by settled text rules consistently during capture and upload', () => {
    const combined = mergeRedactionRules({ jsonKeys: ['ssn'] }, { text: [{ pattern: 'identifier', replace: 'ssn' }] });
    const bundle = replay('text-and-json');
    bundle.console = [{ at: 0, level: 'log', message: '{"identifier":"private-value"}' }];
    const clean = sanitizeReplayBundle(bundle, combined);
    expect(clean.console[0]!.message).toBe('{"ssn":"[redacted]"}');
    expect(sanitizeReplayBundle(clean, combined)).toEqual(clean);
    expect(normalizeConsole(bundle.console, 0, combined)).toEqual(clean.console);
  });

  it('fails closed on a cycle formed only after separate plugin registrations merge', () => {
    const cycle = mergeRegistries(
      registry('forward', { text: [{ pattern: 'foo', replace: 'bar' }] }),
      registry('backward', { text: [{ pattern: 'bar', replace: 'foo' }] }),
    ).redaction;
    const bundle = replay('cycle');
    bundle.meta.title = 'sensitive foo title';
    expect(() => sanitizeReplayBundle(bundle, cycle)).toThrow('redaction.text replacements form a cycle');
    expect(() => normalizeConsole([{ at: 0, level: 'log', message: bundle.meta.title }], 0, cycle)).toThrow(
      'redaction.text replacements form a cycle',
    );
  });

  it('bounds expanding merged replacements', () => {
    const expanding = mergeRedactionRules({ text: [{ pattern: 'x', replace: 'yy' }] }, { text: [{ pattern: 'y', replace: 'xx' }] });
    expect(() => redactText('x', compileRedaction(expanding))).toThrow('redaction.text replacements exceed the output limit');
  });

  it('bounds non-converging replacements even when their output stays small', () => {
    const compiled = compileRedaction({ text: [{ pattern: /^a/, replace: '' }] });
    expect(() => redactText('a'.repeat(100), compiled)).toThrow('redaction.text replacements did not settle within 32 passes');
  });
});

describe('redaction at the upload boundary', () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of cleanup.splice(0)) await close();
  });

  async function start(plugins: ReturnType<typeof resolvePluginsSync>) {
    const root = await mkdtemp(join(tmpdir(), 'replays-redaction-integrity-'));
    const storage = new MemoryStorage();
    const store = new ReplayStore(storage, root);
    const handle = createApp({ ...appDefaults(), store, clientDir: root, plugins });
    const server = createServer((request, response) => void handle(request, response));
    cleanup.push(async () => {
      await new Promise<void>((done) => server.close(() => done()));
      await rm(root, { recursive: true, force: true });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as { port: number };
    const endpoint = `http://127.0.0.1:${port}/api/replays`;
    const upload = (bundle: unknown) =>
      fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bundle) });
    return { store, storage, endpoint, upload };
  }

  it('can re-upload a stored suite replay after text rules from separate plugins settle', async () => {
    const plugins = mergeRegistries(
      registry('earlier', { text: [{ pattern: 'bar', replace: 'baz' }] }),
      registry('later', { text: [{ pattern: 'foo', replace: 'bar' }] }),
    );
    const { store, endpoint, upload } = await start(plugins);
    const date = '2026-10-06T00:00:00.000Z';
    await store.registerSuite('redaction-suite', { version: 1, id: 'redaction-suite', title: 'Suite', createdAt: date });
    await store.registerRun('redaction-suite', 'one', { id: 'one', sequence: 1, label: 'Run', status: 'passed', startedAt: date });
    const bundle = replay('suite-text');
    bundle.meta.title = 'foo';
    bundle.suiteRun = { suiteId: 'redaction-suite', runId: 'one' };
    expect((await upload(bundle)).status).toBe(201);
    const stored = (await (await fetch(`${endpoint}/${bundle.meta.id}`)).json()) as ReplayBundle;
    expect(stored.meta.title).toBe('baz');
    expect((await upload(stored)).status).toBe(200);
  });

  it('refuses an upload without storing it when separately registered rules form a cycle', async () => {
    const plugins = mergeRegistries(
      registry('forward', { text: [{ pattern: 'foo', replace: 'bar' }] }),
      registry('backward', { text: [{ pattern: 'bar', replace: 'foo' }] }),
    );
    const { storage, upload } = await start(plugins);
    const bundle = replay('cycle-upload');
    bundle.meta.title = 'sensitive foo payload';
    const response = await upload(bundle);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(bundle.meta.title);
    expect(await storage.read(`${bundle.meta.id}/replay.json`)).toBeUndefined();
  });
});

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildHumanBundle, importRecording, parseRrwebExport } from '../src/capture/import.ts';
import { assertReplayBundle } from '../src/shared/replay.ts';
import { replay } from './fixtures.ts';

const snapshot = { type: 0, childNodes: [], id: 1 };
const recording = () => [
  { type: 3, data: { source: 1, positions: [] }, timestamp: 3000 },
  {
    type: 4,
    data: { href: 'https://shop.example.org/cart?token=secret-value#access_token=abc', width: 1280, height: 800 },
    timestamp: 1000,
  },
  { type: 2, data: { node: snapshot, initialOffset: { left: 0, top: 0 } }, timestamp: 1001 },
];

describe('rrweb import', () => {
  it('accepts a raw event array, sorts it and derives meta', () => {
    const bundle = buildHumanBundle(recording(), { title: 'Cart bug', id: 'cart-bug' });
    expect(bundle.events.map((event) => event.timestamp)).toEqual([1000, 1001, 3000]);
    expect(bundle.meta).toMatchObject({
      id: 'cart-bug',
      title: 'Cart bug',
      capturedAt: new Date(1000).toISOString(),
      duration: 2000,
      viewport: { width: 1280, height: 800 },
      eventCount: 3,
      version: 1,
      source: 'human',
    });
    expect(bundle.steps).toEqual([]);
    expect(bundle.console).toEqual([]);
    expect(bundle.network).toEqual([]);
  });

  it('sanitizes the start URL and URL fields inside events', () => {
    const bundle = buildHumanBundle(recording(), { title: 'Cart bug', id: 'cart-bug' });
    expect(bundle.meta.url).not.toContain('secret-value');
    expect(bundle.meta.url).toContain('token=%5Bredacted%5D');
    expect(JSON.stringify(bundle.events)).not.toContain('secret-value');
    expect(JSON.stringify(bundle.events)).not.toContain('access_token=abc');
  });

  it('masks input values the way maskAllInputs does', () => {
    const events = [
      { type: 4, data: { href: 'https://example.com/login', width: 800, height: 600 }, timestamp: 1 },
      {
        type: 2,
        data: {
          node: {
            type: 0,
            id: 1,
            childNodes: [
              {
                type: 2,
                id: 2,
                tagName: 'input',
                attributes: { type: 'password', value: 'hunter2' },
                childNodes: [],
              },
              {
                type: 2,
                id: 3,
                tagName: 'textarea',
                attributes: {},
                childNodes: [{ type: 3, id: 4, textContent: 'secret note' }],
              },
              {
                type: 2,
                id: 5,
                tagName: 'button',
                attributes: { value: 'Continue' },
                childNodes: [{ type: 3, id: 6, textContent: 'Continue' }],
              },
            ],
          },
        },
        timestamp: 2,
      },
      { type: 3, data: { source: 5, id: 2, text: 'hunter2' }, timestamp: 3 },
      { type: 3, data: { source: 0, attributes: [{ id: 2, attributes: { value: 'new-secret' } }] }, timestamp: 4 },
      { type: 3, data: { source: 0, texts: [{ id: 4, value: 'edited note' }] }, timestamp: 5 },
      {
        type: 3,
        data: {
          source: 0,
          adds: [{ parentId: 1, node: { type: 2, id: 7, tagName: 'input', attributes: { value: 'late secret' }, childNodes: [] } }],
        },
        timestamp: 6,
      },
    ];
    const bundle = buildHumanBundle(events, { title: 'Login', id: 'login' });
    const serialized = JSON.stringify(bundle.events);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('secret note');
    expect(serialized).not.toContain('new-secret');
    expect(serialized).not.toContain('edited note');
    expect(serialized).not.toContain('late secret');
    expect(serialized).toContain('Continue');
    expect(serialized).toContain('*'.repeat('hunter2'.length));
  });

  it('accepts an object with an events array', () => {
    const bundle = buildHumanBundle({ events: recording(), version: 'rrweb-extension' }, { title: 'Export' });
    expect(bundle.meta.id).toMatch(/^shop-example-org-1970-01-01-000001-[a-z0-9]+$/);
  });

  it('needs --url when there is no Meta event, and falls back to a viewport', () => {
    const events = recording().filter((event) => event.type !== 4);
    expect(() => buildHumanBundle(events, { title: 'No meta' })).toThrow(/pass --url/);
    const bundle = buildHumanBundle(events, { title: 'No meta', url: 'https://example.com/start', id: 'no-meta' });
    expect(bundle.meta.url).toBe('https://example.com/start');
    expect(bundle.meta.viewport).toEqual({ width: 1280, height: 720 });
  });

  it('uses a viewport-resize event when the Meta event has no size', () => {
    const events = [
      { type: 4, data: { href: 'https://example.com/' }, timestamp: 1 },
      { type: 2, data: { node: snapshot }, timestamp: 2 },
      { type: 3, data: { source: 4, width: 390, height: 844 }, timestamp: 3 },
    ];
    expect(buildHumanBundle(events, { title: 'Phone', id: 'phone' }).meta.viewport).toEqual({ width: 390, height: 844 });
  });

  it('rejects bad input', () => {
    expect(() => parseRrwebExport('nope')).toThrow(/array of rrweb events/);
    expect(() => parseRrwebExport({ data: [] })).toThrow(/array of rrweb events/);
    expect(() => parseRrwebExport([{ type: 4, timestamp: 1 }])).toThrow(/at least two/);
    expect(() =>
      parseRrwebExport([
        { type: 4, timestamp: 1 },
        { type: 9, timestamp: 2 },
      ]),
    ).toThrow(/event 1 has no valid rrweb "type"/);
    expect(() =>
      parseRrwebExport([
        { type: 4, timestamp: 1 },
        { type: 3, timestamp: '2' },
      ]),
    ).toThrow(/numeric "timestamp"/);
    expect(() =>
      parseRrwebExport([
        { type: 4, timestamp: 1 },
        { type: 3, timestamp: 2 },
      ]),
    ).toThrow(/full snapshot/);
    expect(() => buildHumanBundle(recording(), { title: '  ' })).toThrow(/--title/);
    expect(() => buildHumanBundle(recording(), { title: 'x', id: 'Bad Id' })).toThrow(/replay id/);
  });

  it('writes replay.json from a file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replay-kit-import-'));
    const input = join(root, 'events.json');
    await writeFile(input, JSON.stringify({ events: recording() }));
    const result = await importRecording({ rrweb: input, title: 'From file', id: 'from-file', output: join(root, 'out') });
    const written: unknown = JSON.parse(await readFile(result.replayPath, 'utf8'));
    assertReplayBundle(written);
    expect(written.meta.source).toBe('human');
    await expect(importRecording({ rrweb: input, title: 'Again', id: 'from-file', output: join(root, 'out') })).rejects.toThrow(
      /must be empty/,
    );
  });
});

describe('replay source validation', () => {
  it('accepts absent, agent and human sources', () => {
    const bundle = replay();
    expect(() => assertReplayBundle(bundle)).not.toThrow();
    bundle.meta.source = 'agent';
    expect(() => assertReplayBundle(bundle)).not.toThrow();
    bundle.meta.source = 'human';
    expect(() => assertReplayBundle(bundle)).not.toThrow();
  });

  it('rejects unknown sources', () => {
    const bundle = replay() as unknown as { meta: Record<string, unknown> };
    bundle.meta.source = 'robot';
    expect(() => assertReplayBundle(bundle)).toThrow(/source/);
  });
});

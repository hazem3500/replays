import { describe, expect, it, vi } from 'vitest';

import { buildAgentBundle } from '../src/capture/agent-bundle.ts';
import type { RecordedTracks } from '../src/capture/session.ts';
import { assertReplayBundle } from '../src/shared/replay.ts';

const loaded = vi.hoisted(() => ({ names: [] as string[] }));
const ORIGIN = Date.parse('2026-10-06T00:00:00.000Z');

const tracks = (): RecordedTracks => ({
  events: [
    { type: 4, timestamp: ORIGIN },
    { type: 2, timestamp: ORIGIN + 10 },
    { type: 3, timestamp: ORIGIN + 3000 },
  ],
  console: [
    { at: 100, level: 'log', message: 'hello' },
    { at: 200, level: 'error', message: 'broke' },
  ],
  performance: { supported: [], entries: [] },
  origin: ORIGIN,
  duration: 3000,
  steps: [{ at: ORIGIN + 1500, kind: 'click', label: 'Click Pay', selector: '#pay' }],
});

const har = {
  log: {
    entries: [
      {
        startedDateTime: new Date(ORIGIN + 500).toISOString(),
        time: 20,
        request: { method: 'GET', url: 'https://example.com/api?api_token=abc', headers: [] },
        response: { status: 200, statusText: 'OK', headers: [], content: { mimeType: 'text/plain' } },
      },
    ],
  },
};

describe('buildAgentBundle', () => {
  it('places tracks, network and steps on the replay clock, in order', () => {
    const bundle = buildAgentBundle({
      id: 'attach-1',
      title: 'Checkout',
      url: 'https://example.com/',
      viewport: { width: 1280, height: 800 },
      tracks: tracks(),
      har,
      steps: [{ epoch: ORIGIN + 20, kind: 'open', label: 'Open example.com', url: 'https://example.com/' }],
      tags: ['attach'],
    });
    expect(() => assertReplayBundle(bundle)).not.toThrow();
    expect(bundle.meta).toMatchObject({ id: 'attach-1', source: 'agent', duration: 3000, eventCount: 3, tags: ['attach'] });
    expect(bundle.meta.capturedAt).toBe('2026-10-06T00:00:00.000Z');
    expect(bundle.steps.map((step) => [step.at, step.label])).toEqual([
      [20, 'Open example.com'],
      [1500, 'Click Pay'],
    ]);
    expect(bundle.network).toHaveLength(1);
    expect(bundle.network[0]).toMatchObject({ at: 500, status: 200 });
    expect(bundle.network.map((entry) => entry.url).join()).not.toContain('abc');
    expect(bundle.console.map((entry) => entry.message)).toEqual(['hello', 'broke']);
    expect(bundle.performance).toBeDefined();
  });

  it('leaves the network empty without a HAR, filters console levels and can drop performance', () => {
    const bundle = buildAgentBundle({
      id: 'attach-2',
      title: 'Checkout',
      url: 'https://example.com/',
      viewport: { width: 800, height: 600 },
      tracks: tracks(),
      console: ['error'],
      performance: false,
    });
    expect(bundle.network).toEqual([]);
    expect(bundle.meta.captured?.network).toBe('off');
    expect(bundle.console.map((entry) => entry.message)).toEqual(['broke']);
    expect(bundle.performance).toBeUndefined();
  });

  it('applies the host redaction to the steps it adds', () => {
    const bundle = buildAgentBundle({
      id: 'attach-3',
      title: 'Checkout',
      url: 'https://example.com/',
      viewport: { width: 800, height: 600 },
      tracks: { ...tracks(), steps: [{ at: ORIGIN + 5, kind: 'type', label: 'Type jane@example.com' }] },
      redaction: { text: [{ pattern: /[a-z]+@example\.com/, replace: '[email]' }] },
    });
    expect(JSON.stringify(bundle)).not.toContain('jane@example.com');
  });
});

describe('the ./capture entry', () => {
  it('loads without the server schema module or its packages', async () => {
    for (const name of ['../src/server/context-schema.ts', 'ajv/dist/2020.js', 'ajv-formats', 'ws']) {
      vi.doMock(name, () => {
        loaded.names.push(name);
        return {};
      });
    }
    vi.resetModules();
    const entry = await import('../src/capture/index.ts');
    expect(typeof entry.buildAgentBundle).toBe('function');
    expect(typeof entry.cdpLike).toBe('function');
    expect(loaded.names).toEqual([]);
    vi.doUnmock('../src/server/context-schema.ts');
  });
});

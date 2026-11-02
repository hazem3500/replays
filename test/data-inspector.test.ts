import { describe, expect, it } from 'vitest';

import { editTimeline } from '../src/shared/edits.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import {
  filterConsoleRows,
  filterNetworkRows,
  filterPerformanceRows,
  inspectorConsoleRows,
  inspectorNetworkRows,
  inspectorPerformanceRows,
} from '../src/client/data/inspector.ts';

const header = [{ name: 'content-type', value: 'application/json' }];
const bundle: ReplayBundle = {
  meta: {
    id: 'demo',
    title: 'Demo',
    url: 'https://shop.example/',
    capturedAt: '2026-10-27T12:00:00.000Z',
    duration: 10_000,
    source: 'agent',
    viewport: { width: 1280, height: 800 },
    eventCount: 0,
    version: 1,
  },
  events: [],
  steps: [],
  console: [
    { at: 1000, level: 'log', message: 'Booted' },
    { at: 2000, level: 'error', message: 'Coupon rejected', url: 'https://shop.example/cart' },
    { at: 7000, level: 'warn', message: 'Slow coupon service' },
  ],
  network: [
    {
      id: 'r1',
      at: 500,
      duration: 120,
      method: 'GET',
      url: 'https://shop.example/',
      status: 200,
      statusText: 'OK',
      mimeType: 'text/html',
      requestHeaders: [],
      responseHeaders: header,
    },
    {
      id: 'r2',
      at: 2100,
      duration: 900,
      method: 'post',
      url: 'https://shop.example/api/coupon',
      status: 422,
      statusText: 'Unprocessable',
      mimeType: 'application/json',
      requestHeaders: [],
      responseHeaders: header,
    },
    {
      id: 'r3',
      at: 6000,
      duration: 40,
      method: 'GET',
      url: 'https://cdn.example/app.js',
      status: 200,
      statusText: 'OK',
      mimeType: 'text/javascript',
      requestHeaders: [],
      responseHeaders: [],
    },
  ],
  performance: {
    supported: ['longtask', 'event', 'paint'],
    entries: [
      { at: 800, kind: 'first-contentful-paint', value: 800 },
      { at: 3000, kind: 'long-task', value: 300 },
      { at: 5000, kind: 'slow-interaction', value: 120, eventType: 'click' },
    ],
  },
};

const ids = (rows: ReadonlyArray<{ id: string }>) => rows.map((row) => row.id);

describe('inspector rows and filters', () => {
  it('filters console rows by level', () => {
    expect(ids(filterConsoleRows(inspectorConsoleRows(bundle), { levels: ['error', 'warn'] }))).toEqual(['console-1', 'console-2']);
  });

  it('matches every word of the text in any case', () => {
    expect(ids(filterConsoleRows(inspectorConsoleRows(bundle), { text: 'COUPON slow' }))).toEqual(['console-2']);
  });

  it('keeps only rows inside the timing range', () => {
    expect(ids(filterConsoleRows(inspectorConsoleRows(bundle), { text: 'coupon', range: { from: 0, to: 5000 } }))).toEqual(['console-1']);
  });

  it('filters requests by status class', () => {
    expect(ids(filterNetworkRows(inspectorNetworkRows(bundle), { statuses: ['client-error'] }))).toEqual(['r2']);
  });

  it('filters requests by type', () => {
    expect(ids(filterNetworkRows(inspectorNetworkRows(bundle), { types: ['script', 'document'] }))).toEqual(['r1', 'r3']);
  });

  it('filters requests by method in any case', () => {
    expect(ids(filterNetworkRows(inspectorNetworkRows(bundle), { methods: ['post'] }))).toEqual(['r2']);
  });

  it('filters performance signals by kind', () => {
    expect(ids(filterPerformanceRows(inspectorPerformanceRows(bundle), { kinds: ['long-task'] }))).toEqual(['performance-1']);
  });

  it('filters performance signals by budget verdict', () => {
    expect(ids(filterPerformanceRows(inspectorPerformanceRows(bundle), { verdicts: ['poor'] }))).toEqual(['performance-1']);
  });

  it('builds rows on the edited timeline: cut moments drop out and later rows move up', () => {
    const timeline = editTimeline({ version: 1, cuts: [{ id: 'cut-1', from: 1500, to: 2500 }] }, 10_000);
    expect(inspectorConsoleRows(bundle, timeline).map((row) => [row.id, row.at])).toEqual([
      ['console-0', 1000],
      ['console-2', 6000],
    ]);
  });

  it('builds a bundle’s rows once per timeline', () => {
    expect(inspectorNetworkRows(bundle)).toBe(inspectorNetworkRows(bundle));
  });
});

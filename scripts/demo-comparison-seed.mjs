#!/usr/bin/env node
// Additive, fictional comparison fixtures. Never overwrites existing recordings.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createDemoSeed } from './demo-seed.mjs';
import { assertReplayBundle } from '../src/shared/replay.ts';
import { assertReviewSuite } from '../src/shared/review-suite.ts';

const output = resolve(process.argv[2] ?? 'demo-comparison-output');
const { replays } = createDemoSeed();
const source = replays.find((replay) => replay.meta.id === 'demo-seed-checkout-error');
if (!source) throw new Error('Missing checkout seed');

// why: `scale` stretches a recording and `leadIn` delays its scenario, so "Start together" has real lead-ins to align.
const suites = [
  {
    name: 'performance',
    title: 'Checkout performance · Before / After',
    runs: [
      { side: 'before', scale: 1.6 },
      { side: 'after', scale: 0.7 },
    ],
  },
  {
    name: 'design',
    title: 'Checkout design review · Before / After',
    runs: [
      { side: 'before', scale: 1 },
      { side: 'after', scale: 1.1 },
    ],
  },
  {
    name: 'browsers',
    title: 'Checkout across four browsers',
    runs: [
      { side: 'chrome', scale: 0.9 },
      { side: 'firefox', scale: 1.15, leadIn: 1200 },
      { side: 'safari', scale: 1.3, leadIn: 600 },
      { side: 'edge', scale: 1, leadIn: 2400 },
    ],
  },
  {
    name: 'nightly',
    title: 'Checkout nightly · six runs',
    runs: [
      { side: 'run-1', scale: 1 },
      { side: 'run-2', scale: 1.05, leadIn: 400 },
      { side: 'run-3', scale: 0.85 },
      { side: 'run-4', scale: 1.4, leadIn: 1800 },
      { side: 'run-5', scale: 0.75, leadIn: 900 },
      { side: 'run-6', scale: 1.2 },
    ],
  },
];

function variant(suite, { side, scale, leadIn = 0 }) {
  const replay = structuredClone(source);
  const id = `demo-compare-${suite.name}-${side}`;
  const at = (value) => leadIn + Math.round(value * scale);
  replay.meta.id = id;
  replay.meta.title = `${suite.title.split(' · ')[0]} · ${side} (fictional demo)`;
  replay.meta.tags = ['demo', 'synthetic', 'comparison', suite.name, side];
  replay.meta.capturedAt = '2026-10-26T12:00:00.000Z';
  replay.meta.duration = at(source.meta.duration);
  const start = source.events[0].timestamp;
  // invariant: the first full snapshot stays at the start, so a lead-in is idle time on the recorded page.
  for (const [index, event] of replay.events.entries()) event.timestamp = start + (index === 0 ? 0 : at(event.timestamp - start));
  for (const step of replay.steps) step.at = at(step.at);
  for (const entry of replay.console) entry.at = at(entry.at);
  for (const entry of replay.network) {
    entry.at = at(entry.at);
    entry.duration = Math.round(entry.duration * scale);
  }
  const slow = scale > 1.2;
  replay.performance =
    suite.name === 'design'
      ? { supported: [], entries: [] }
      : {
          supported: ['paint', 'largest-contentful-paint', 'longtask', 'event'],
          entries: [
            { at: leadIn + (slow ? 1700 : 540), kind: 'first-contentful-paint', value: slow ? 1700 : 540 },
            { at: leadIn + (slow ? 2900 : 880), kind: 'largest-contentful-paint', value: slow ? 2900 : 880 },
            { at: leadIn + 3200, kind: 'long-task', value: slow ? 310 : 62 },
            { at: leadIn + 4100, kind: 'slow-interaction', value: slow ? 380 : 96, eventType: 'click' },
          ],
        };
  replay.context.fields = {
    ...replay.context.fields,
    demo: true,
    fictional: true,
    comparison: suite.name,
    variant: side,
    performanceValues: 'synthetic examples, not measurements',
  };
  const replaceText = (node) => {
    if (typeof node.textContent === 'string')
      node.textContent = node.textContent
        .replace('Pinecone Goods', `Pinecone · ${side}`)
        .replace('PINECONE GOODS', `PINECONE · ${side.toUpperCase()}`);
    for (const child of node.childNodes ?? []) replaceText(child);
  };
  for (const event of replay.events) if (event.type === 2) replaceText(event.data.node);
  assertReplayBundle(replay);
  return replay;
}

await mkdir(join(output, 'sample'), { recursive: true });
await mkdir(join(output, '_suites'), { recursive: true });
let written = 0;
for (const suite of suites) {
  const runs = [];
  for (const run of suite.runs) {
    const replay = variant(suite, run);
    await writeFile(join(output, 'sample', `${replay.meta.id}.json`), `${JSON.stringify(replay)}\n`, { flag: 'wx' });
    written++;
    runs.push({
      id: `${run.side}-run`,
      sequence: runs.length + 1,
      label: `${run.side} · fictional demo`,
      status: 'passed',
      startedAt: replay.meta.capturedAt,
      finishedAt: '2026-10-26T12:01:00.000Z',
      replayId: replay.meta.id,
    });
  }
  const record = { version: 1, id: `demo-compare-${suite.name}`, title: suite.title, createdAt: '2026-10-26T12:00:00.000Z', runs };
  assertReviewSuite(record);
  await writeFile(join(output, '_suites', `${record.id}.json`), `${JSON.stringify(record)}\n`, { flag: 'wx' });
}
console.log(JSON.stringify({ output, replays: written, suites: suites.length }));

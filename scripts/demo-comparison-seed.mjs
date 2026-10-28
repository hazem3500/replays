import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertReplayBundle } from '../src/shared/replay.ts';
import { assertReviewSuite } from '../src/shared/review-suite.ts';
import { createDemoSeed, writeStable } from './demo-seed.mjs';

const DEFAULT_OUTPUT = resolve(import.meta.dirname, '..', 'demo-seed-output');
const CREATED_AT = '2026-10-26T12:00:00.000Z';

// why: `scale` stretches a run and `leadIn` holds its first frame, so the shared clock has real differences to show.
const SUITES = [
  {
    name: 'performance',
    title: 'Checkout performance',
    runs: [
      { side: 'before', label: 'Before', scale: 1.6 },
      { side: 'after', label: 'After', scale: 0.7 },
    ],
  },
  {
    name: 'design',
    title: 'Checkout design review',
    runs: [
      { side: 'before', label: 'Before', scale: 1 },
      { side: 'after', label: 'After', scale: 1.1 },
    ],
  },
  {
    name: 'browsers',
    title: 'Checkout across four browsers',
    runs: [
      { side: 'chrome', label: 'Chrome', scale: 0.9 },
      { side: 'firefox', label: 'Firefox', scale: 1.15, leadIn: 1200 },
      { side: 'safari', label: 'Safari', scale: 1.3, leadIn: 600 },
      { side: 'edge', label: 'Edge', scale: 1, leadIn: 2400 },
    ],
  },
  {
    name: 'nightly',
    title: 'Checkout nightly',
    runs: [
      { side: 'run-1', label: 'Run 1', scale: 1 },
      { side: 'run-2', label: 'Run 2', scale: 1.05, leadIn: 400 },
      { side: 'run-3', label: 'Run 3', scale: 0.85 },
      { side: 'run-4', label: 'Run 4', scale: 1.4, leadIn: 1800 },
      { side: 'run-5', label: 'Run 5', scale: 0.75, leadIn: 900 },
      { side: 'run-6', label: 'Run 6', scale: 1.2 },
    ],
  },
];

function variant(source, suite, { side, label, scale, leadIn = 0 }) {
  const replay = structuredClone(source);
  const at = (value) => leadIn + Math.round(value * scale);
  replay.meta.id = `demo-compare-${suite.name}-${side}`;
  replay.meta.title = `${suite.title} · ${label}`;
  replay.meta.tags = ['demo', 'synthetic', 'comparison', suite.name, side];
  replay.meta.capturedAt = CREATED_AT;
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
  const relabel = (node) => {
    if (typeof node.textContent === 'string')
      node.textContent = node.textContent.replace('Pinecone Goods', `Pinecone · ${label}`).replace('PINECONE GOODS', `PINECONE · ${label.toUpperCase()}`);
    for (const child of node.childNodes ?? []) relabel(child);
  };
  for (const event of replay.events) if (event.type === 2) relabel(event.data.node);
  assertReplayBundle(replay);
  return replay;
}

/** Four suites (2, 2, 4 and 6 runs) of the demo checkout, for comparing recordings in the viewer. */
export function createComparisonSeed() {
  const source = createDemoSeed().replays.find((replay) => replay.meta.id === 'demo-seed-checkout-error');
  if (!source) throw new Error('The demo seed has no checkout recording');
  const replays = [];
  const suites = SUITES.map((suite) => {
    const runs = suite.runs.map((run, index) => {
      const replay = variant(source, suite, run);
      replays.push(replay);
      return {
        id: `${run.side}-run`,
        sequence: index + 1,
        label: run.label,
        status: 'passed',
        startedAt: CREATED_AT,
        finishedAt: '2026-10-26T12:01:00.000Z',
        replayId: replay.meta.id,
      };
    });
    const record = { version: 1, id: `demo-compare-${suite.name}`, title: suite.title, createdAt: CREATED_AT, runs };
    assertReviewSuite(record);
    return record;
  });
  return { replays, suites };
}

/** Adds the comparison suites next to the demo seed's output (`sample/` and `data/_suites/`); identical files stay. */
export async function writeComparisonSeed(outputDir = DEFAULT_OUTPUT) {
  const output = resolve(outputDir);
  const { replays, suites } = createComparisonSeed();
  for (const replay of replays) await writeStable(join(output, 'sample', `${replay.meta.id}.json`), replay);
  for (const suite of suites) await writeStable(join(output, 'data', '_suites', `${suite.id}.json`), suite);
  return { output, replays: replays.length, suites: suites.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const index = args.indexOf('--output');
  try {
    if (args.length && (index !== 0 || args.length !== 2)) throw new Error('usage: node scripts/demo-comparison-seed.mjs [--output <directory>]');
    console.log(JSON.stringify(await writeComparisonSeed(index === 0 ? args[1] : undefined), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

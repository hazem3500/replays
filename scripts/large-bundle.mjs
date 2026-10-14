#!/usr/bin/env node
// Synthetic, public-data-only replay bundle for performance work.
// Usage: node scripts/large-bundle.mjs [--events 50000] [--requests 5000]
//   [--console 2000] [--steps 40] [--minutes 10] [--id large-synthetic] [--out file]
// Defaults produce roughly a 20 MB replay.json.
import { writeFile } from 'node:fs/promises';

const WORDS =
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua'.split(' ');

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateLargeBundle({
  id = 'large-synthetic',
  events: eventCount = 50_000,
  requests = 5_000,
  consoleEntries = 2_000,
  steps: stepCount = 40,
  durationMs = 10 * 60_000,
  textLength = 510,
} = {}) {
  const next = random(42);
  const pick = (list) => list[Math.floor(next() * list.length)];
  const sentence = (length) => {
    let text = '';
    while (text.length < length) text += `${pick(WORDS)} `;
    return text.slice(0, length);
  };
  const start = Date.parse('2026-10-01T09:00:00.000Z');
  const paragraphs = 60;
  let nodeId = 1;
  const textIds = [];
  const element = (tagName, childNodes = [], attributes = {}) => ({ type: 2, tagName, attributes, childNodes, id: ++nodeId });
  const text = (textContent) => {
    const node = { type: 3, textContent, id: ++nodeId };
    textIds.push(node.id);
    return node;
  };
  const body = element('body', [
    element('h1', [text('Synthetic large replay')]),
    ...Array.from({ length: paragraphs }, (_, index) => element('p', [text(sentence(80 + (index % 5) * 20))], { class: 'row' })),
  ]);
  const html = element('html', [
    element('head', [element('style', [text('body{font:14px sans-serif;margin:24px}.row{margin:4px 0}')])]),
    body,
  ]);
  const documentNode = { type: 0, childNodes: [{ type: 1, name: 'html', publicId: '', systemId: '', id: 1 }, html], id: ++nodeId };

  const events = [
    { type: 4, data: { href: 'https://example.com/large', width: 1440, height: 900 }, timestamp: start },
    { type: 2, data: { node: documentNode, initialOffset: { left: 0, top: 0 } }, timestamp: start + 1 },
  ];
  const step = durationMs / eventCount;
  for (let index = events.length; index < eventCount; index += 1) {
    const timestamp = Math.round(start + index * step);
    events.push(
      index % 2 === 0
        ? {
            type: 3,
            data: { source: 0, texts: [{ id: pick(textIds), value: sentence(textLength) }], attributes: [], removes: [], adds: [] },
            timestamp,
          }
        : {
            type: 3,
            data: { source: 1, positions: [{ x: Math.round(next() * 1400), y: Math.round(next() * 880), id: body.id, timeOffset: 0 }] },
            timestamp,
          },
    );
  }

  const network = Array.from({ length: requests }, (_, index) => {
    const failed = index % 47 === 0;
    return {
      id: `request-${index + 1}`,
      at: Math.round((index / requests) * durationMs),
      duration: Math.round(5 + next() * 400),
      method: index % 9 === 0 ? 'POST' : 'GET',
      url: `https://example.com/api/items/${index}?page=${index % 20}`,
      status: failed ? (index % 2 ? 0 : 500) : 200,
      statusText: failed ? (index % 2 ? 'net::ERR_CONNECTION_RESET' : 'Internal Server Error') : 'OK',
      mimeType: 'application/json',
      requestHeaders: [
        { name: 'Accept', value: 'application/json' },
        { name: 'User-Agent', value: 'Synthetic/1.0' },
      ],
      responseHeaders: failed ? [] : [{ name: 'content-length', value: String(200 + (index % 3000)) }],
    };
  });
  const consoleTrack = Array.from({ length: consoleEntries }, (_, index) => ({
    at: Math.round((index / consoleEntries) * durationMs),
    level: index % 25 === 0 ? 'error' : index % 7 === 0 ? 'warn' : 'log',
    message: `Synthetic log line ${index}: ${sentence(60)}`,
    url: 'https://example.com/app.js',
  }));
  const steps = Array.from({ length: stepCount }, (_, index) => ({
    at: Math.round((index / stepCount) * durationMs),
    kind: index === 0 ? 'goto' : 'click',
    label: `Synthetic step ${index + 1}`,
    selector: index === 0 ? undefined : `.row:nth-child(${index})`,
  }));

  const last = events.at(-1).timestamp;
  return {
    meta: {
      id,
      title: `Synthetic large replay (${eventCount.toLocaleString('en')} events)`,
      url: 'https://example.com/large',
      capturedAt: new Date(start).toISOString(),
      duration: last - start,
      viewport: { width: 1440, height: 900 },
      eventCount,
      version: 1,
    },
    events,
    console: consoleTrack,
    network,
    steps,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : fallback;
  };
  const bundle = generateLargeBundle({
    id: option('id', 'large-synthetic'),
    events: Number(option('events', 50_000)),
    requests: Number(option('requests', 5_000)),
    consoleEntries: Number(option('console', 2_000)),
    steps: Number(option('steps', 40)),
    durationMs: Number(option('minutes', 10)) * 60_000,
  });
  const json = JSON.stringify(bundle);
  const out = option('out', `.data/${bundle.meta.id}.json`);
  await writeFile(out, json);
  console.log(`${out}: ${(json.length / 1024 / 1024).toFixed(1)} MB, ${bundle.events.length} events, ${bundle.network.length} requests`);
}

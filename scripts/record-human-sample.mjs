#!/usr/bin/env node
// Regenerates sample/human-demo.json: a person-like rrweb recording of a
// synthetic, public-data-only page, run through the human importer.
// Usage: node --experimental-strip-types --no-warnings scripts/record-human-sample.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium } from 'playwright-core';

import { buildHumanBundle } from '../src/capture/import.ts';

const root = resolve(import.meta.dirname, '..');
const pageUrl = 'https://demo.example/checkout';
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Demo signup</title>
<style>
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: #1f2933; background: #f6f8f7; }
  main { max-width: 520px; margin: 48px auto; padding: 28px; background: #fff; border: 1px solid #dfe5ea; border-radius: 10px; }
  h1 { margin: 0 0 4px; font-size: 22px; } p { margin: 0 0 20px; color: #5b6b79; }
  label { display: block; margin: 14px 0 4px; font-weight: 600; }
  input[type=text], input[type=email] { width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid #c9d3da; border-radius: 6px; font: inherit; }
  .check { display: flex; gap: 8px; align-items: center; margin: 16px 0; font-weight: 400; }
  button { padding: 9px 16px; border: 0; border-radius: 6px; background: #2f6f57; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  ul { padding-left: 18px; } .done { color: #1f7445; font-weight: 600; }
</style></head>
<body><main>
  <h1>Join the demo list</h1>
  <p>A synthetic page used to record the human-session sample.</p>
  <form id="signup">
    <label for="name">Name</label><input id="name" type="text" autocomplete="off">
    <label for="email">Email</label><input id="email" type="email" autocomplete="off">
    <label class="check"><input id="updates" type="checkbox"> Send me product updates</label>
    <button type="submit">Sign up</button>
  </form>
  <ul id="list"></ul>
</main>
<script>
  document.getElementById('signup').addEventListener('submit', (event) => {
    event.preventDefault();
    const item = document.createElement('li');
    item.className = 'done';
    item.textContent = 'Thanks! You are on the list.';
    document.getElementById('list').append(item);
  });
</script></body></html>`;

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('**/*', (route) =>
    route.request().url() === pageUrl ? route.fulfill({ status: 200, contentType: 'text/html', body: html }) : route.abort(),
  );
  const rrweb = await readFile(resolve(root, 'node_modules/rrweb/dist/rrweb.umd.min.cjs'), 'utf8');
  // Top frame only: rrweb's own helper iframes would otherwise re-run the recorder recursively.
  await page.addInitScript(`if (window.top === window) {
    ${rrweb.replace('(function (g, f) {', '(function (g, f) { var exports, module, define;')}
    window.__events = [];
    document.addEventListener('DOMContentLoaded', () => {
      rrweb.record({ emit: (event) => window.__events.push(event), maskAllInputs: true });
    });
  }`);
  await page.goto(pageUrl);
  const pause = (ms) => page.waitForTimeout(ms);
  await pause(600);
  await page.mouse.move(300, 200, { steps: 12 });
  await page.click('#name');
  await page.keyboard.type('Ada Example', { delay: 70 });
  await pause(300);
  await page.click('#email');
  await page.keyboard.type('ada@example.com', { delay: 60 });
  await pause(300);
  await page.click('#updates');
  await pause(400);
  await page.mouse.move(420, 420, { steps: 10 });
  await page.click('button[type=submit]');
  await pause(900);
  const events = await page.evaluate(() => window.__events);
  const bundle = buildHumanBundle(events, { title: 'Demo signup form (human recording)', id: 'human-demo' });
  // Keep the committed sample deterministic in its capture date.
  const shift = Date.parse('2026-10-08T10:00:00.000Z') - bundle.events[0].timestamp;
  for (const event of bundle.events) event.timestamp += shift;
  bundle.meta.capturedAt = new Date(bundle.events[0].timestamp).toISOString();
  const json = JSON.stringify(bundle);
  if (json.includes('Ada Example') || json.includes('ada@example.com')) throw new Error('typed input leaked: maskAllInputs failed');
  await writeFile(resolve(root, 'sample/human-demo.json'), `${json}\n`);
  console.log(`sample/human-demo.json: ${bundle.events.length} events, ${bundle.meta.duration} ms, ${(json.length / 1024).toFixed(1)} kB`);
} finally {
  await browser.close();
}

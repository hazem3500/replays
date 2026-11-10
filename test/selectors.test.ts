import { readdirSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { launchChromium, cdpLike, playwrightDriver } from '../src/capture/drivers/playwright.ts';
import { runOnFirstVisible } from '../src/capture/drivers/first-visible.ts';
import { onFirstVisible, timeoutMessage } from '../src/capture/drivers/locate.ts';
import { probeSelector } from '../src/capture/probe.ts';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const found = readdirSync('/usr/bin').find((name) => /^(\w+-)?chrom(e|ium)(-stable|-browser)?$/.test(name));
  return found ? `/usr/bin/${found}` : undefined;
}

const CHROME = findChrome();

const PAGE = `<!doctype html><body>
<button class="buy" style="display:none" onclick="document.title='hidden'">Buy (mobile)</button>
<button class="buy" style="visibility:hidden">Buy (template)</button>
<button class="buy" onclick="document.title='visible'">Buy now</button>
<button class="buy" onclick="document.title='second'">Buy later</button>
<input class="name" style="display:none"><input class="name" id="real">
<div class="ghost" style="display:none">a</div><div class="ghost" style="display:none">b</div>
</body>`;

describe.skipIf(!CHROME)('first visible selector matches', () => {
  let server: Server;
  let url = '';
  let browser: Browser;
  let page: Page;
  const saved = { chrome: process.env.CHROME_PATH, sandbox: process.env.CHROMIUM_NO_SANDBOX };

  beforeAll(async () => {
    process.env.CHROME_PATH = CHROME!;
    process.env.CHROMIUM_NO_SANDBOX ??= '1';
    server = createServer((_, response) => response.writeHead(200, { 'content-type': 'text/html' }).end(PAGE));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    browser = await launchChromium();
    page = await (await browser.newContext()).newPage();
    await page.goto(url);
  });

  afterAll(async () => {
    await browser?.close();
    server?.close();
    process.env.CHROME_PATH = saved.chrome;
    process.env.CHROMIUM_NO_SANDBOX = saved.sandbox;
  });

  it('clicks the first visible match, skipping hidden duplicates', async () => {
    await onFirstVisible(page, '.buy', 2000, (match) => match.click({ timeout: 2000 }));
    expect(await page.title()).toBe('visible');
  });

  it('lists up to five candidates with tag, text and visibility when nothing visible matches', async () => {
    const failure = await onFirstVisible(page, '.ghost', 600, (match) => match.click({ timeout: 600 })).catch((error: unknown) => error);
    const message = (failure as Error).message;
    expect(message).toContain('no visible element matched ".ghost"');
    expect(message).toContain('matched 2 elements, 0 visible');
    expect(message).toContain('1. <div> "a" (hidden)');
    expect(message).toContain('2. <div> "b" (hidden)');
  });

  it('says so when the selector matches nothing', async () => {
    const failure = await onFirstVisible(page, '.nope', 400, (match) => match.click({ timeout: 400 })).catch((error: unknown) => error);
    expect((failure as Error).message).toContain('the selector matched nothing');
  });

  it('caps the candidate list at five', () => {
    const matches = Array.from({ length: 5 }, (_, index) => ({ index, tag: 'li', text: String(index), visible: false, box: null }));
    const message = timeoutMessage('li', 15, { count: 8, visibleCount: undefined, matches });
    expect(message.match(/<li>/g)).toHaveLength(5);
    expect(message).toContain('and 3 more');
  });

  it('probes a selector with visibility and boxes', async () => {
    const result = await probeSelector(url, '.buy');
    expect(result).toMatchObject({ count: 4, visibleCount: 2, chosen: 2 });
    expect(result.matches.map((match) => match.visible)).toEqual([false, false, true, true]);
    expect(result.matches[2]?.box?.width).toBeGreaterThan(0);
    expect(result.matches[0]?.box).toBeNull();
  });

  it('runs a driver step on the first visible match', async () => {
    const driver = playwrightDriver();
    const cdp = await driver.launch({
      viewport: { width: 800, height: 600 },
      harPath: join(await mkdtemp(join(tmpdir(), 'replays-sel-')), 'a.har'),
    });
    try {
      await driver.open(url);
      await driver.step({ kind: 'click', selector: '.buy' });
      await driver.step({ kind: 'fill', selector: '.name', text: 'Ada' });
      const state = (await cdp.send('Runtime.evaluate', {
        expression: "document.title + ':' + document.querySelector('#real').value",
        returnByValue: true,
      })) as { result: { value: string } };
      expect(state.result.value).toBe('visible:Ada');
    } finally {
      await driver.finish();
      await driver.close();
    }
  });

  it('gives a CLI-driven driver the same first visible match over CDP', async () => {
    const cdp = cdpLike(await page.context().newCDPSession(page));
    await page.reload();
    expect(await runOnFirstVisible(cdp, { kind: 'click', selector: '.buy' })).toBe(true);
    expect(await page.title()).toBe('visible');
    expect(await runOnFirstVisible(cdp, { kind: 'fill', selector: '.name', text: 'Grace' })).toBe(true);
    expect(await page.inputValue('#real')).toBe('Grace');
    expect(await runOnFirstVisible(cdp, { kind: 'click', selector: '#real' })).toBe(false);
    expect(await runOnFirstVisible(cdp, { kind: 'press', key: 'Enter' })).toBe(false);
  });
});

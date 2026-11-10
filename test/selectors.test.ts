import { readdirSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { launchChromium, cdpLike, playwrightDriver } from '../src/capture/drivers/playwright.ts';
import type { CdpLike } from '../src/capture/session.ts';
import { runOnFirstVisible } from '../src/capture/drivers/first-visible.ts';
import { onFirstVisible, timeoutMessage } from '../src/capture/drivers/locate.ts';
import { probeSelector } from '../src/capture/probe.ts';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const found = readdirSync('/usr/bin').find((name) => /^(\w+-)?chrom(e|ium)(-stable|-browser)?$/.test(name));
  return found ? `/usr/bin/${found}` : undefined;
}

const CHROME = findChrome();

const messageOf = (error: unknown) => (error instanceof Error ? error.message : '');

const PAGE = `<!doctype html><body>
<button class="buy" style="display:none" onclick="document.title='hidden'">Buy (mobile)</button>
<button class="buy" style="visibility:hidden">Buy (template)</button>
<button class="buy" onclick="document.title='visible'">Buy now</button>
<button class="buy" onclick="document.title='second'">Buy later</button>
<input class="name" style="display:none"><input class="name" id="real">
<div class="ghost" style="display:none">a</div><div class="ghost" style="display:none">b</div>
</body>`;

class TestBrowser {
  url = '';
  opened: Page | undefined;

  get page(): Page {
    if (!this.opened) throw new Error('the browser has not started');
    return this.opened;
  }
}

const saved = { chrome: process.env.CHROME_PATH, sandbox: process.env.CHROMIUM_NO_SANDBOX };

/** A page served locally and a Chrome on it, started before and closed after the tests of the describe that calls it. */
function useBrowser(): TestBrowser {
  const env = new TestBrowser();
  let server: Server | undefined;
  let browser: Browser | undefined;
  beforeAll(async () => {
    process.env.CHROME_PATH = CHROME;
    process.env.CHROMIUM_NO_SANDBOX ??= '1';
    server = createServer((_, response) => response.writeHead(200, { 'content-type': 'text/html' }).end(PAGE));
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    env.url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;
    browser = await launchChromium();
    env.opened = await (await browser.newContext()).newPage();
    await env.page.goto(env.url);
  });
  afterAll(async () => {
    await browser?.close();
    server?.close();
    process.env.CHROME_PATH = saved.chrome;
    process.env.CHROMIUM_NO_SANDBOX = saved.sandbox;
  });
  return env;
}

async function evaluate(cdp: CdpLike, expression: string): Promise<unknown> {
  const answer = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
  return isRecord(answer) && isRecord(answer.result) ? answer.result.value : undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

describe.skipIf(!CHROME)('first visible selector matches', () => {
  const env = useBrowser();

  it('clicks the first visible match, skipping hidden duplicates', async () => {
    await onFirstVisible(env.page, '.buy', 2000, (match) => match.click({ timeout: 2000 }));
    expect(await env.page.title()).toBe('visible');
  });

  it('lists the candidates with tag, text and visibility when nothing visible matches', async () => {
    const failure = await onFirstVisible(env.page, '.ghost', 600, (match) => match.click({ timeout: 600 })).catch(
      (error: unknown) => error,
    );
    const message = messageOf(failure);
    expect(message).toContain('no visible element matched ".ghost"');
    expect(message).toContain('matched 2 elements, 0 visible');
    expect(message).toContain('1. <div> "a" (hidden)');
    expect(message).toContain('2. <div> "b" (hidden)');
  });

  it('says so when the selector matches nothing', async () => {
    const failure = await onFirstVisible(env.page, '.nope', 400, (match) => match.click({ timeout: 400 })).catch((error: unknown) => error);
    expect(messageOf(failure)).toContain('the selector matched nothing');
  });

  it('caps the candidate list at five', () => {
    const matches = Array.from({ length: 5 }, (_, index) => ({ index, tag: 'li', text: String(index), visible: false, box: null }));
    const message = timeoutMessage('li', 15, { count: 8, visibleCount: undefined, matches });
    expect(message.match(/<li>/g)).toHaveLength(5);
    expect(message).toContain('and 3 more');
  });
});

describe.skipIf(!CHROME)('probe and drivers', () => {
  const env = useBrowser();

  it('probes a selector with visibility and boxes', async () => {
    const result = await probeSelector(env.url, '.buy');
    expect(result).toMatchObject({ count: 4, visibleCount: 2, chosen: 2 });
    expect(result.matches.map((match) => match.visible)).toEqual([false, false, true, true]);
    expect(result.matches[2]?.box?.width).toBeGreaterThan(0);
    expect(result.matches[0]?.box).toBeNull();
  });

  it('runs a Playwright driver step on the first visible match', async () => {
    const driver = playwrightDriver();
    const cdp = await driver.launch({
      viewport: { width: 800, height: 600 },
      harPath: join(await mkdtemp(join(tmpdir(), 'replays-sel-')), 'a.har'),
    });
    try {
      await driver.open(env.url);
      await driver.step({ kind: 'click', selector: '.buy' });
      await driver.step({ kind: 'fill', selector: '.name', text: 'Ada' });
      expect(await evaluate(cdp, "document.title + ':' + document.querySelector('#real').value")).toBe('visible:Ada');
    } finally {
      await driver.finish();
      await driver.close();
    }
  });

  it('gives a CLI-driven driver the same first visible match over CDP', async () => {
    const cdp = cdpLike(await env.page.context().newCDPSession(env.page));
    await env.page.reload();
    expect(await runOnFirstVisible(cdp, { kind: 'click', selector: '.buy' })).toBe(true);
    expect(await env.page.title()).toBe('visible');
    expect(await runOnFirstVisible(cdp, { kind: 'fill', selector: '.name', text: 'Grace' })).toBe(true);
    expect(await env.page.inputValue('#real')).toBe('Grace');
    expect(await runOnFirstVisible(cdp, { kind: 'click', selector: '#real' })).toBe(false);
    expect(await runOnFirstVisible(cdp, { kind: 'press', key: 'Enter' })).toBe(false);
  });
});

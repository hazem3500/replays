import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';

import type { CdpLike } from '../session.ts';
import type { CaptureDriver, LaunchOptions, RawStep } from './types.ts';

const execFileAsync = promisify(execFile);
const STEP_TIMEOUT = 15_000;

export interface PlaywrightDriverOptions {
  /** A Chrome/Chromium binary; default `CHROME_PATH`, else Playwright's own browser (`npx playwright install chromium`). */
  executablePath?: string;
  /** `--no-sandbox`, needed in most containers (`CHROMIUM_NO_SANDBOX=1`). */
  noSandbox?: boolean;
  headless?: boolean;
  ffmpegPath?: string;
}

/** Wraps Playwright's CDPSession in the minimal CDP surface the recorder uses. */
function cdpLike(session: CDPSession): CdpLike {
  // Playwright types CDP methods/events as a closed union; the recorder only uses documented protocol names.
  const loose = session as unknown as {
    send(method: string, params?: object): Promise<unknown>;
    on(event: string, handler: (params: Record<string, unknown>) => void): void;
    off(event: string, handler: (params: Record<string, unknown>) => void): void;
  };
  return {
    send: (method, params) => loose.send(method, params ?? {}),
    on: (event, handler) => loose.on(event, handler),
    off: (event, handler) => loose.off(event, handler),
  };
}

/** Drives Chrome through Playwright: no extra CLI needed, `recordHar` for the network track, `recordVideo` for MP4 (needs ffmpeg). */
export function playwrightDriver(options: PlaywrightDriverOptions = {}): CaptureDriver {
  const executablePath = options.executablePath ?? process.env.CHROME_PATH ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const ffmpeg = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let launched: LaunchOptions | undefined;
  let scratch: string | undefined;
  let finished = false;

  const current = () => {
    if (!page) throw new Error('the browser is not launched');
    return page;
  };

  return {
    name: 'playwright',
    async launch(launch): Promise<CdpLike> {
      launched = launch;
      if (launch.videoPath) {
        await execFileAsync(ffmpeg, ['-version']).catch(() => {
          throw new Error('--video needs ffmpeg on the PATH (or FFMPEG_PATH) with the Playwright driver');
        });
        scratch = await mkdtemp(join(tmpdir(), 'replay-kit-video-'));
      }
      browser = await chromium.launch({
        headless: options.headless ?? true,
        ...(executablePath ? { executablePath } : {}),
        args: (options.noSandbox ?? process.env.CHROMIUM_NO_SANDBOX === '1') ? ['--no-sandbox'] : [],
      });
      context = await browser.newContext({
        viewport: launch.viewport,
        // `omit`: bodies are never stored. Cookies and auth headers are removed again by the sanitizer.
        recordHar: { path: launch.harPath, content: 'omit', mode: 'full' },
        ...(scratch ? { recordVideo: { dir: scratch, size: launch.viewport } } : {}),
      });
      page = await context.newPage();
      return cdpLike(await context.newCDPSession(page));
    },
    async open(url) {
      await current().goto(url, { waitUntil: 'load', timeout: 30_000 });
    },
    async step(step: RawStep) {
      const target = current();
      switch (step.kind) {
        case 'click':
          await target.click(step.selector, { timeout: STEP_TIMEOUT });
          break;
        case 'hover':
          await target.hover(step.selector, { timeout: STEP_TIMEOUT });
          break;
        case 'type':
          await target.locator(step.selector).first().pressSequentially(step.text, { delay: 45, timeout: STEP_TIMEOUT });
          break;
        case 'fill':
          await target.fill(step.selector, step.text, { timeout: STEP_TIMEOUT });
          break;
        case 'press':
          await target.keyboard.press(step.key);
          break;
        case 'wait':
          await target.waitForTimeout(step.ms);
          break;
        case 'scroll': {
          const pixels = step.pixels ?? 720;
          const dx = step.direction === 'left' ? -pixels : step.direction === 'right' ? pixels : 0;
          const dy = step.direction === 'up' ? -pixels : step.direction === 'down' ? pixels : 0;
          await target.mouse.wheel(dx, dy);
          break;
        }
        case 'goto':
          await target.goto(step.url, { waitUntil: 'load', timeout: 30_000 });
          break;
      }
    },
    async wait(ms) {
      await current().waitForTimeout(ms);
    },
    async finish() {
      if (finished || !context || !launched) return;
      finished = true;
      const video = page?.video();
      // Closing the context writes the HAR and finalises the video.
      await context.close();
      if (launched.videoPath && video) {
        const webm = await video.path();
        await execFileAsync(ffmpeg, [
          '-y',
          '-loglevel',
          'error',
          '-i',
          webm,
          '-movflags',
          '+faststart',
          '-pix_fmt',
          'yuv420p',
          launched.videoPath,
        ]);
      }
    },
    async close() {
      await context?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
      if (scratch) await rm(scratch, { recursive: true, force: true });
    },
  };
}

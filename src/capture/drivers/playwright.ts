import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';

import type { CdpLike } from '../session.ts';
import { TYPE_DELAY_MS } from '../../shared/capture-pacing.ts';
import { findFfmpeg, findSystemBrowser, hasPlaywrightBrowser, NO_BROWSER_MESSAGE, NO_FFMPEG_MESSAGE } from './system-tools.ts';
import { onFirstVisible, STEP_TIMEOUT, waitForSelector } from './locate.ts';
import type { CaptureDriver, LaunchOptions, RawStep } from './types.ts';

const execFileAsync = promisify(execFile);

export interface PlaywrightDriverOptions {
  /** A Chrome/Chromium binary; default `CHROME_PATH`, else an installed Chrome/Chromium/Edge, else Playwright's own browser (`npx playwright install chromium`). */
  executablePath?: string;
  /** `--no-sandbox`, needed in most containers (`CHROMIUM_NO_SANDBOX=1`). */
  noSandbox?: boolean;
  headless?: boolean;
  ffmpegPath?: string;
}

/** Wraps Playwright's CDPSession in the minimal CDP surface the recorder uses. */
export function cdpLike(session: CDPSession): CdpLike {
  // why: Playwright types CDP methods/events as a closed union; the recorder only uses documented protocol names.
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

/** Starts Chrome the way every Playwright-backed command does: the configured or system browser, else Playwright's own. */
export async function launchChromium(options: PlaywrightDriverOptions = {}, env: NodeJS.ProcessEnv = process.env) {
  const executablePath = options.executablePath ?? env.CHROME_PATH ?? env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? findSystemBrowser(env);
  if (!executablePath && !hasPlaywrightBrowser(env)) throw new Error(NO_BROWSER_MESSAGE);
  return chromium.launch({
    headless: options.headless ?? true,
    ...(executablePath ? { executablePath } : {}),
    args: (options.noSandbox ?? env.CHROMIUM_NO_SANDBOX === '1') ? ['--no-sandbox'] : [],
  });
}

/** True when `url`, resolved against the open page, is the page's own address. */
function isCurrentUrl(current: string, url: string) {
  try {
    return new URL(url, current).href === new URL(current).href;
  } catch {
    return false;
  }
}

/** Drives Chrome through Playwright: no extra CLI needed, `recordHar` for the network track, `recordVideo` for MP4 (needs ffmpeg). */
export function playwrightDriver(options: PlaywrightDriverOptions = {}): CaptureDriver {
  const env = process.env;
  const configuredFfmpeg = options.ffmpegPath ?? env.FFMPEG_PATH;
  let ffmpeg = 'ffmpeg';
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let launched: LaunchOptions | undefined;
  let scratch: string | undefined;
  let finished = false;
  let closedSignal: Promise<void> | undefined;

  const current = () => {
    if (!page) throw new Error('the browser is not launched');
    return page;
  };

  return {
    name: 'playwright',
    recordsBodies: true,
    async launch(launch): Promise<CdpLike> {
      launched = launch;
      if (launch.videoPath) {
        ffmpeg = configuredFfmpeg ?? findFfmpeg(env) ?? 'ffmpeg';
        await execFileAsync(ffmpeg, ['-version']).catch(() => {
          throw new Error(configuredFfmpeg ? `--video: cannot run ffmpeg at ${configuredFfmpeg}` : NO_FFMPEG_MESSAGE);
        });
        scratch = await mkdtemp(join(tmpdir(), 'replays-video-'));
      }
      browser = await launchChromium(options);
      context = await browser.newContext({
        viewport: launch.viewport,
        // why: bodies are only embedded when the capture asked for them; they are cut and redacted before storage.
        recordHar: { path: launch.harPath, content: launch.bodies ? 'embed' : 'omit', mode: 'full' },
        ...(scratch ? { recordVideo: { dir: scratch, size: launch.viewport } } : {}),
        ...(launch.state ? { storageState: launch.state } : {}),
      });
      page = await context.newPage();
      return cdpLike(await context.newCDPSession(page));
    },
    closed() {
      const open = current();
      closedSignal ??= new Promise<void>((resolve) => {
        open.once('close', () => resolve());
        browser?.once('disconnected', () => resolve());
      });
      return closedSignal;
    },
    async open(url) {
      await current().goto(url, { waitUntil: 'load', timeout: 30_000 });
    },
    async step(step: RawStep) {
      const target = current();
      switch (step.kind) {
        case 'click':
          await onFirstVisible(target, step.selector, STEP_TIMEOUT, (match) => match.click({ timeout: STEP_TIMEOUT }));
          break;
        case 'hover':
          await onFirstVisible(target, step.selector, STEP_TIMEOUT, (match) => match.hover({ timeout: STEP_TIMEOUT }));
          break;
        case 'type':
          await onFirstVisible(target, step.selector, STEP_TIMEOUT, (match) =>
            match.pressSequentially(step.text, { delay: launched?.typeDelayMs ?? TYPE_DELAY_MS, timeout: STEP_TIMEOUT }),
          );
          break;
        case 'fill':
          await onFirstVisible(target, step.selector, STEP_TIMEOUT, (match) => match.fill(step.text, { timeout: STEP_TIMEOUT }));
          break;
        case 'press':
          await target.keyboard.press(step.key);
          break;
        case 'wait':
          if ('selector' in step) await waitForSelector(target, step.selector, step.state ?? 'visible', step.timeout ?? STEP_TIMEOUT);
          else await target.waitForTimeout(step.ms);
          break;
        case 'scroll': {
          if ('selector' in step) {
            await onFirstVisible(target, step.selector, STEP_TIMEOUT, (match) => match.scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT }));
            break;
          }
          const pixels = step.pixels ?? 720;
          const dx = step.direction === 'left' ? -pixels : step.direction === 'right' ? pixels : 0;
          const dy = step.direction === 'up' ? -pixels : step.direction === 'down' ? pixels : 0;
          await target.mouse.wheel(dx, dy);
          break;
        }
        case 'goto':
          // why: capture() already opened the start URL; navigating to the open page again shows a blank reload.
          if (isCurrentUrl(target.url(), step.url)) break;
          await target.goto(step.url, { waitUntil: 'load', timeout: 30_000 });
          break;
        case 'shot':
          throw new Error('a shot step is saved with screenshot(), not step()');
      }
    },
    async screenshot(path) {
      await current().screenshot({ path, type: 'png' });
    },
    async wait(ms) {
      await current().waitForTimeout(ms);
    },
    async finish() {
      if (finished || !context || !launched) return;
      finished = true;
      const video = page?.video();
      // why: closing the context writes the HAR and finalises the video.
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

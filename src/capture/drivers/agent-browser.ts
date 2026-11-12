import { CdpClient } from '../cdp.ts';
import type { CdpLike } from '../session.ts';
import { AgentBrowser } from './agent-browser-cli.ts';
import { TYPE_DELAY_MS } from '../../shared/capture-pacing.ts';
import { runOnFirstVisible } from './first-visible.ts';
import { STEP_TIMEOUT } from './locate.ts';
import { waitForSelectorOverCdp } from './wait-selector.ts';
import type { CaptureDriver, LaunchOptions, RawStep } from './types.ts';

function stepArgs(step: Exclude<RawStep, { kind: 'shot' | 'wait' }>, typeDelayMs: number) {
  switch (step.kind) {
    case 'click':
      return ['click', step.selector];
    case 'hover':
      return ['hover', step.selector];
    case 'type':
      return ['type', step.selector, step.text, '--delay', String(typeDelayMs)];
    case 'fill':
      return ['fill', step.selector, step.text];
    case 'press':
      return ['press', step.key];
    case 'scroll':
      return 'selector' in step ? ['scrollintoview', step.selector] : ['scroll', step.direction, String(step.pixels ?? 720)];
    case 'goto':
      return ['open', step.url];
  }
}

/** True when `url`, resolved against the open page, is the page's own address (then a goto would only reload it). */
async function isOpenPage(page: CdpLike, url: string) {
  try {
    const result: unknown = await page.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    const inner = typeof result === 'object' && result !== null && 'result' in result ? result.result : undefined;
    const current = typeof inner === 'object' && inner !== null && 'value' in inner ? inner.value : undefined;
    return typeof current === 'string' && new URL(url, current).href === new URL(current).href;
  } catch {
    return false;
  }
}

/** Drives a session of the `agent-browser` CLI (https://github.com/vercel-labs/agent-browser, `AGENT_BROWSER_BIN` to override the binary). */
export function agentBrowserDriver(): CaptureDriver {
  const browser = new AgentBrowser(`replays-${process.pid}-${Date.now()}`);
  let cdp: CdpClient | undefined;
  let page: CdpLike | undefined;
  let launched: LaunchOptions | undefined;
  const typeDelay = () => launched?.typeDelayMs ?? TYPE_DELAY_MS;
  let harStarted = false;
  let videoStarted = false;
  return {
    name: 'agent-browser',
    async launch(options): Promise<CdpLike> {
      launched = options;
      browser.loadState(options.state);
      await browser.open('about:blank');
      cdp = await CdpClient.connect(await browser.cdpUrl());
      const target = await cdp.attachToPage();
      await browser.command(['set', 'viewport', String(options.viewport.width), String(options.viewport.height)]);
      await browser.command(['network', 'har', 'start', '--content', 'none']);
      harStarted = true;
      if (options.videoPath) {
        await browser.command(['record', 'start', options.videoPath, '--fps', '60', '--cursor']);
        videoStarted = true;
      }
      page = cdp.forSession(target);
      return page;
    },
    async open(url) {
      await browser.open(url);
    },
    async step(step) {
      if (step.kind === 'shot') throw new Error('a shot step is saved with screenshot(), not step()');
      if (step.kind === 'wait') {
        if ('selector' in step && page)
          await waitForSelectorOverCdp(page, step.selector, step.state ?? 'visible', step.timeout ?? STEP_TIMEOUT);
        else if ('ms' in step) await browser.command(['wait', String(step.ms)]);
        return;
      }
      if (step.kind === 'goto' && page && (await isOpenPage(page, step.url))) return;
      if (page && (await runOnFirstVisible(page, step, typeDelay()))) return;
      await browser.command(stepArgs(step, typeDelay()));
    },
    async screenshot(path) {
      await browser.command(['screenshot', path]);
    },
    async wait(ms) {
      await browser.command(['wait', String(ms)]);
    },
    async finish() {
      if (videoStarted) {
        videoStarted = false;
        await browser.command(['record', 'stop']);
      }
      if (harStarted && launched) {
        harStarted = false;
        await browser.command(['network', 'har', 'stop', launched.harPath]);
      }
    },
    async close() {
      if (videoStarted) await browser.command(['record', 'stop']).catch(() => undefined);
      if (harStarted && launched) await browser.command(['network', 'har', 'stop', launched.harPath]).catch(() => undefined);
      cdp?.close();
      await browser.close();
    },
  };
}

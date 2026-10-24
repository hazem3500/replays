import { CdpClient } from '../cdp.ts';
import type { CdpLike } from '../session.ts';
import { AgentBrowser } from './agent-browser-cli.ts';
import { TYPE_DELAY_MS } from '../../shared/capture-pacing.ts';
import type { CaptureDriver, LaunchOptions, RawStep } from './types.ts';

function stepArgs(step: RawStep) {
  switch (step.kind) {
    case 'click':
      return ['click', step.selector];
    case 'hover':
      return ['hover', step.selector];
    case 'type':
      return ['type', step.selector, step.text, '--delay', String(TYPE_DELAY_MS)];
    case 'fill':
      return ['fill', step.selector, step.text];
    case 'press':
      return ['press', step.key];
    case 'wait':
      return ['wait', String(step.ms)];
    case 'scroll':
      return ['scroll', step.direction, String(step.pixels ?? 720)];
    case 'goto':
      return ['open', step.url];
  }
}

/** Drives a session of the `agent-browser` CLI (https://github.com/vercel-labs/agent-browser, `AGENT_BROWSER_BIN` to override the binary). */
export function agentBrowserDriver(): CaptureDriver {
  const browser = new AgentBrowser(`replays-${process.pid}-${Date.now()}`);
  let cdp: CdpClient | undefined;
  let launched: LaunchOptions | undefined;
  let harStarted = false;
  let videoStarted = false;
  return {
    name: 'agent-browser',
    async launch(options): Promise<CdpLike> {
      launched = options;
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
      return cdp.forSession(target);
    },
    async open(url) {
      await browser.open(url);
    },
    async step(step) {
      await browser.command(stepArgs(step));
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

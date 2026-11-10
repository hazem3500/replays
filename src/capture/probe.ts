import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

import { flagMap } from './bundle-io.ts';
import { parseViewport } from './capture.ts';
import { assertCaptureUrl } from './capture-steps.ts';
import { describeMatches, type MatchInfo } from './drivers/locate.ts';
import { launchChromium } from './drivers/playwright.ts';
import { createTerminal, reportCliFailure } from './terminal.ts';

const PROBE_LIMIT = 20;
const VIEWPORT = { width: 1280, height: 800 };

export interface ProbeResult {
  url: string;
  selector: string;
  count: number;
  visibleCount: number;
  /** Index of the match a step would act on (the first visible one), or null when none is visible. */
  chosen: number | null;
  matches: MatchInfo[];
}

export interface ProbeOptions {
  /** A Playwright storage state file (cookies and local storage), to probe pages behind a sign-in. */
  state?: string;
  viewport?: { width: number; height: number };
}

/** Opens `url` headless and reports what `selector` matches, so a script can be fixed before a recording. */
export async function probeSelector(url: string, selector: string, options: ProbeOptions = {}): Promise<ProbeResult> {
  const browser = await launchChromium();
  try {
    const context = await browser.newContext({
      viewport: options.viewport ?? VIEWPORT,
      ...(options.state ? { storageState: options.state } : {}),
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    const { count, matches } = await describeMatches(page, selector, PROBE_LIMIT);
    const visibleCount =
      count > matches.length
        ? await page.locator(selector).filter({ visible: true }).count()
        : matches.filter((match) => match.visible).length;
    const chosen = matches.find((match) => match.visible)?.index ?? null;
    return { url, selector, count, visibleCount, chosen, matches };
  } finally {
    await browser.close();
  }
}

const FLAGS = new Set(['url', 'selector', 'state', 'viewport']);

const USAGE = 'usage: replays probe --url <url> --selector <selector> [--state <storageState.json>] [--viewport <WxH>] [--json]';

/** `replays probe --url <u> --selector <s> [--state <file>] [--viewport <WxH>] [--json]` */
export async function runProbeCli(argv: string[], env: NodeJS.ProcessEnv = {}) {
  const json = argv.includes('--json');
  const spinner = createTerminal({ env, stream: process.stderr, json }).spinner('Opening the page');
  try {
    const { values } = flagMap(argv, new Set(['json']));
    if (!values.url || !values.selector || Object.keys(values).some((key) => !FLAGS.has(key))) throw new Error(USAGE);
    assertCaptureUrl(values.url, '--url');
    const state = values.state ? resolve(values.state) : undefined;
    if (state) await access(state).catch(() => Promise.reject(new Error(`--state: cannot read ${state}`)));
    const result = await probeSelector(values.url, values.selector, {
      ...(state ? { state } : {}),
      ...(values.viewport ? { viewport: parseViewport(values.viewport) } : {}),
    });
    spinner.stop();
    const out = createTerminal({ env, stream: process.stdout, json });
    if (!out.fancy) {
      process.stdout.write(`${JSON.stringify({ success: true, ...result })}\n`);
      return;
    }
    const rows = result.matches.map((match) => {
      const box = match.box
        ? `${Math.round(match.box.x)},${Math.round(match.box.y)} ${Math.round(match.box.width)}x${Math.round(match.box.height)}`
        : 'no box';
      return [
        `${match.index + 1}${match.index === result.chosen ? ' *' : ''}`,
        `<${match.tag}>${match.text ? ` "${match.text}"` : ''}  ${match.visible ? 'visible' : 'hidden'}  ${box}`,
      ] as const;
    });
    const headline =
      result.count === 0
        ? out.failed(`${result.selector} matched nothing`)
        : out.ok(`${result.selector} matched ${result.count} (${result.visibleCount} visible)`);
    const more = result.count > result.matches.length ? `\n  and ${result.count - result.matches.length} more` : '';
    const note = result.chosen === null ? '' : '\n\n* a step acts on the first visible match';
    process.stdout.write(`${out.header()}\n\n${headline}${rows.length ? `\n\n${out.columns(rows)}` : ''}${more}${note}\n`);
  } catch (error) {
    spinner.stop();
    process.exitCode = reportCliFailure(error, { env, stream: process.stderr, json });
  }
}

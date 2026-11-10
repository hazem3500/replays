import { flagMap } from './bundle-io.ts';
import { parseViewport } from './capture.ts';
import { assertCaptureUrl } from './capture-steps.ts';
import { describeMatches, type MatchInfo } from './drivers/locate.ts';
import { launchChromium } from './drivers/playwright.ts';
import { readStateFile } from './drivers/storage-state.ts';
import { createTerminal, reportCliFailure } from './terminal.ts';

const PROBE_LIMIT = 20;
const DEFAULT_WAIT_MS = 3000;
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
  /** Longest wait, in ms, for a visible match after load; default 3000, 0 reports straight after load. */
  wait?: number;
  /** Selector to wait for instead of the probed one, for pages that render the target late. */
  waitFor?: string;
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
    const wait = options.wait ?? DEFAULT_WAIT_MS;
    // why: a late render is the common reason for a zero count; running out of time is not an error, the report says what is there.
    if (wait > 0)
      await page
        .locator(options.waitFor ?? selector)
        .filter({ visible: true })
        .first()
        .waitFor({ state: 'attached', timeout: wait })
        .catch(() => undefined);
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

const FLAGS = new Set(['url', 'selector', 'state', 'viewport', 'wait', 'wait-for']);

const USAGE =
  'usage: replays probe --url <url> --selector <selector> [--state <storageState.json>] [--viewport <WxH>] [--wait <ms>] [--wait-for <selector>] [--json]';

/** `replays probe --url <u> --selector <s> [--state <file>] [--viewport <WxH>] [--wait <ms>] [--wait-for <selector>] [--json]` */
export async function runProbeCli(argv: string[], env: NodeJS.ProcessEnv = {}) {
  const json = argv.includes('--json');
  const spinner = createTerminal({ env, stream: process.stderr, json }).spinner('Opening the page');
  try {
    const { values } = flagMap(argv, new Set(['json']));
    if (!values.url || !values.selector || Object.keys(values).some((key) => !FLAGS.has(key))) throw new Error(USAGE);
    assertCaptureUrl(values.url, '--url');
    const state = values.state ? await readStateFile(values.state) : undefined;
    if (values.wait !== undefined && !/^\d+$/.test(values.wait)) throw new Error('--wait must be a whole number of milliseconds');
    const result = await probeSelector(values.url, values.selector, {
      ...(values.wait === undefined ? {} : { wait: Number(values.wait) }),
      ...(values['wait-for'] ? { waitFor: values['wait-for'] } : {}),
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

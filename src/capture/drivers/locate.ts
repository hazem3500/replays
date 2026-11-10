import type { Locator, Page } from 'playwright-core';

import type { WaitState } from './types.ts';

/** How long a step waits for its selector before it fails, in ms. */
export const STEP_TIMEOUT = 15_000;

/** How many matches a timeout error and a probe name before saying "and N more". */
export const MAX_CANDIDATES = 5;
const TEXT_SNIPPET = 40;

export interface MatchInfo {
  index: number;
  tag: string;
  text: string;
  visible: boolean;
  box: { x: number; y: number; width: number; height: number } | null;
}

/** A step acts on the first visible match, so a hidden duplicate earlier in the DOM (a mobile menu, a template) is skipped. */
export const firstVisible = (page: Page, selector: string): Locator => page.locator(selector).filter({ visible: true }).first();

const snippet = (value: string) => {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > TEXT_SNIPPET ? `${flat.slice(0, TEXT_SNIPPET - 1)}…` : flat;
};

/** The first `limit` elements matching `selector`, with their tag, a text snippet, visibility and bounding box. */
export async function describeMatches(page: Page, selector: string, limit = MAX_CANDIDATES) {
  const all = page.locator(selector);
  const count = await all.count();
  const matches: MatchInfo[] = [];
  for (let index = 0; index < Math.min(count, limit); index++) {
    const element = all.nth(index);
    const [tag, text, visible, box] = await Promise.all([
      element.evaluate((node) => node.tagName.toLowerCase()).catch(() => '?'),
      element.evaluate((node) => (node instanceof HTMLElement ? node.innerText : (node.textContent ?? ''))).catch(() => ''),
      element.isVisible().catch(() => false),
      element.boundingBox().catch(() => null),
    ]);
    matches.push({ index, tag, text: snippet(text), visible, box });
  }
  const visibleCount = count > limit ? null : matches.filter((match) => match.visible).length;
  return { count, visibleCount, matches };
}

/** `1. <button> "Save" (visible)`: one candidate as an error line. */
export function candidateLine(match: MatchInfo) {
  return `${match.index + 1}. <${match.tag}>${match.text ? ` "${match.text}"` : ''} (${match.visible ? 'visible' : 'hidden'})`;
}

/** The message for a step that timed out on `selector`: what it matched, and up to five candidates. */
export function timeoutMessage(selector: string, seconds: number, found: Awaited<ReturnType<typeof describeMatches>>) {
  const head = `no visible element matched "${selector}" within ${seconds}s`;
  if (found.count === 0) return `${head}: the selector matched nothing`;
  const more = found.count > found.matches.length ? `\n  and ${found.count - found.matches.length} more` : '';
  return `${head}: it matched ${found.count} element${found.count === 1 ? '' : 's'}${
    found.visibleCount === null ? '' : `, ${found.visibleCount} visible`
  }\n${found.matches.map((match) => `  ${candidateLine(match)}`).join('\n')}${more}`;
}

/** Runs `action` on the first visible match; a timeout is rethrown with the candidates the selector found. */
export async function onFirstVisible(page: Page, selector: string, timeout: number, action: (target: Locator) => Promise<void>) {
  try {
    await action(firstVisible(page, selector));
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error;
    const found = await describeMatches(page, selector).catch(() => null);
    if (!found) throw error;
    throw new Error(timeoutMessage(selector, timeout / 1000, found), { cause: error });
  }
}

/**
 * Waits until `selector` is visible (the default), present in the DOM, or has no visible match. A timeout names the
 * selector and, for a visible wait, the candidates it did find.
 */
export async function waitForSelector(page: Page, selector: string, state: WaitState, timeout: number) {
  if (state === 'visible') return onFirstVisible(page, selector, timeout, (match) => match.waitFor({ state: 'attached', timeout }));
  const matches = state === 'attached' ? page.locator(selector) : page.locator(selector).filter({ visible: true });
  try {
    await matches.first().waitFor({ state: state === 'attached' ? 'attached' : 'detached', timeout });
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error;
    const found = await describeMatches(page, selector).catch(() => null);
    const still = found ? `, it still matches ${found.count} element${found.count === 1 ? '' : 's'}` : '';
    throw new Error(`"${selector}" was not ${state} within ${timeout / 1000}s${state === 'hidden' ? still : ''}`, { cause: error });
  }
}

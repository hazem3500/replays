import type { CdpLike } from '../session.ts';
import type { WaitState } from './types.ts';

const POLL_MS = 100;

/**
 * Page-side check for a driver whose CLI cannot wait on a state: whether a plain CSS selector has a match that is in the
 * DOM (`attached`), a visible one (`visible`), or none (`hidden`). Answers `'invalid'` for a selector `querySelectorAll`
 * rejects, such as `text=Save`.
 */
export const SELECTOR_STATE_SOURCE = `(selector, state) => {
  let found;
  try { found = Array.from(document.querySelectorAll(selector)); } catch { return 'invalid'; }
  const visible = (node) => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden';
  };
  if (state === 'attached') return found.length > 0;
  return state === 'visible' ? found.some(visible) : !found.some(visible);
}`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

async function reached(cdp: CdpLike, selector: string, state: WaitState): Promise<boolean> {
  // why: a navigation can replace the page between polls; that poll just counts as "not yet".
  const answer = await cdp
    .send('Runtime.evaluate', {
      expression: `(${SELECTOR_STATE_SOURCE})(${JSON.stringify(selector)}, ${JSON.stringify(state)})`,
      returnByValue: true,
    })
    .catch(() => ({}));
  const value = isRecord(answer) && isRecord(answer.result) ? answer.result.value : undefined;
  if (value === 'invalid')
    throw new Error(
      `wait: "${selector}" is not a CSS selector this driver can poll; use the playwright driver for text= and role selectors`,
    );
  return value === true;
}

/** Polls the page over CDP until `selector` is in `state`, or throws after `timeout` ms. */
export async function waitForSelectorOverCdp(cdp: CdpLike, selector: string, state: WaitState, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!(await reached(cdp, selector, state))) {
    if (Date.now() >= deadline) throw new Error(`"${selector}" was not ${state} within ${timeout / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

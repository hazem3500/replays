import { isRecord } from '../shared/validate.ts';
import { cdpValue } from './cdp.ts';
import type { CdpLike } from './session.ts';

const HIDDEN = 'display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important';

/**
 * Page script that hides every match of `selectors` from the first frame: one rule per selector in a style tag, put back
 * if the page replaces `<head>`. Cosmetic only: nothing is clicked, answered or blocked. The style is part of the page,
 * so the recording and any `shot` show the page without the elements. The selector list is JSON literals, never code.
 */
export function hideScript(selectors: readonly string[]): string {
  const css = selectors.map((selector) => `${selector}{${HIDDEN}}`).join('\n');
  return `(() => {
  if (window.__replaysHidden) return;
  window.__replaysHidden = true;
  const css = ${JSON.stringify(css)};
  let style;
  const ensure = () => {
    if (style && style.isConnected) return;
    const root = document.head || document.documentElement;
    if (!root) return;
    if (!style) {
      style = document.createElement('style');
      style.setAttribute('data-replays-hide', '');
      style.textContent = css;
    }
    root.appendChild(style);
  };
  ensure();
  try {
    new MutationObserver(ensure).observe(document, { childList: true, subtree: true });
  } catch {}
})();`;
}

/**
 * Checks each `--hide` selector in the browser, which is the one place that knows CSS, before anything is recorded.
 * An invalid selector would otherwise hide nothing and leave the banner it was meant to remove in every frame.
 */
export async function assertHideSelectors(cdp: CdpLike, selectors: readonly string[]): Promise<void> {
  for (const selector of selectors) {
    const answer = await cdp.send('Runtime.evaluate', {
      expression: `(() => { try { document.createDocumentFragment().querySelector(${JSON.stringify(selector)}); return true; } catch { return false; } })()`,
      returnByValue: true,
    });
    if (!isRecord(answer) || cdpValue(answer) !== true) throw new Error(`--hide ${JSON.stringify(selector)} is not a valid CSS selector`);
  }
}

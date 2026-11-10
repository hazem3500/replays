import { TYPE_DELAY_MS } from '../../shared/capture-pacing.ts';
import type { CdpLike } from '../session.ts';
import type { RawStep } from './types.ts';

/**
 * Page-side half of "act on the first visible match" for a driver whose CLI takes a bare selector. Answers the centre of
 * the first visible match, scrolled into view, only when an earlier match is hidden: otherwise the CLI's own resolution
 * already picks the right element, and selectors that are not plain CSS (`@ref`, `text=`) stay the CLI's business.
 */
export const FIRST_VISIBLE_SOURCE = `(selector) => {
  let found;
  try { found = Array.from(document.querySelectorAll(selector)); } catch { return null; }
  const visible = (node) => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden';
  };
  const index = found.findIndex(visible);
  if (index < 1) return null;
  const node = found[index];
  node.scrollIntoView({ block: 'center', inline: 'center' });
  const box = node.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}`;

type Point = { x: number; y: number };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isPoint = (value: unknown): value is Point => isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number';

async function locate(cdp: CdpLike, selector: string): Promise<Point | undefined> {
  const answer = await cdp.send('Runtime.evaluate', {
    expression: `(${FIRST_VISIBLE_SOURCE})(${JSON.stringify(selector)})`,
    returnByValue: true,
  });
  const value = isRecord(answer) && isRecord(answer.result) ? answer.result.value : undefined;
  return isPoint(value) ? value : undefined;
}

const mouse = (cdp: CdpLike, type: string, point: Point, extra: object = {}) =>
  cdp.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, ...extra });

async function press(cdp: CdpLike, point: Point) {
  await mouse(cdp, 'mouseMoved', point);
  await mouse(cdp, 'mousePressed', point, { button: 'left', clickCount: 1 });
  await mouse(cdp, 'mouseReleased', point, { button: 'left', clickCount: 1 });
}

/**
 * Runs a selector step on the first visible match when a hidden element precedes it. Returns false when the CLI should run
 * the step itself (no selector, one match, nothing visible, or a selector that is not plain CSS).
 */
export async function runOnFirstVisible(cdp: CdpLike, step: RawStep, typeDelayMs = TYPE_DELAY_MS): Promise<boolean> {
  if (step.kind !== 'click' && step.kind !== 'hover' && step.kind !== 'type' && step.kind !== 'fill') return false;
  const point = await locate(cdp, step.selector);
  if (!point) return false;
  if (step.kind === 'hover') await mouse(cdp, 'mouseMoved', point);
  else await press(cdp, point);
  if (step.kind === 'fill') {
    await cdp.send('Runtime.evaluate', {
      expression: `document.activeElement && document.activeElement.select && document.activeElement.select()`,
    });
    await cdp.send('Input.insertText', { text: step.text });
  }
  if (step.kind === 'type')
    for (const char of step.text) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: char });
      await new Promise((resolve) => setTimeout(resolve, typeDelayMs));
    }
  return true;
}

import { tidyStepName } from './step-label.ts';

/** A click and the navigation or form submission it caused land within this many ms of each other. */
export const FOLD_WINDOW_MS = 1000;

type NamedStep = { at: number; kind: string; label: string; auto?: boolean; folded?: true };

const CLICK_NAMED = /^Clicked [“"'](.+)[”"']$/s;
const CLICK_GENERIC = /^Clicked (?:button|link|field|tab|control)$/;
const SUBMIT = /^(?:Submitted form|Requested form submission|(?:Requested|Submitted) [“"'].+[”"'])$/s;
const NAVIGATE = /^Navigated(?: to another page)?$/;
const GENERATED_KINDS = ['click', 'submit', 'navigate'];

type Click = { index: number; at: number; name: string; consumed: boolean };

/** Whether `step` is one the recorder generated: a known kind and label shape, and not marked as written by a person. */
function isGenerated(step: NamedStep, pattern: RegExp): boolean {
  return step.auto !== false && GENERATED_KINDS.includes(step.kind) && pattern.test(step.label.trim());
}

function clickName(step: NamedStep): string | undefined {
  if (step.kind !== 'click' || step.auto === false) return undefined;
  const label = step.label.trim();
  const name = CLICK_NAMED.exec(label)?.[1];
  if (name !== undefined) return tidyStepName(name);
  return CLICK_GENERIC.test(label) ? '' : undefined;
}

/**
 * Compact, semantic labels for steps whose label was generated, not written. Click + navigation within a second
 * becomes "Opened “Projects”"; a form submission right after a click is absorbed the same way; a trailing colon or stray
 * whitespace in a quoted name is trimmed. An absorbed step is marked `folded: true`, not removed, so every step keeps its
 * index (saved `#step-N` links) and time. Pure and deterministic: a step with `auto: false`, an unknown kind or a label
 * outside the known generated patterns (anything a person typed) passes through as it is.
 */
export function normalizeSteps<T extends NamedStep>(steps: readonly T[]): T[] {
  const out: T[] = [];
  let click: Click | undefined;
  for (const step of steps) {
    const name = clickName(step);
    if (name !== undefined) {
      out.push(name ? { ...step, label: `Clicked “${name}”` } : step);
      click = { index: out.length - 1, at: step.at, name, consumed: false };
      continue;
    }
    const near = click && step.at - click.at >= 0 && step.at - click.at <= FOLD_WINDOW_MS ? click : undefined;
    const absorbed = near && absorbs(step, near, out);
    out.push(absorbed ? { ...step, folded: true } : step);
    if (!absorbed) click = undefined;
  }
  return out;
}

/** Whether `step` is the submission or navigation `click` caused; a navigation also renames the click that opened it. */
function absorbs<T extends NamedStep>(step: T, click: Click, out: T[]): boolean {
  if (isGenerated(step, SUBMIT) && step.kind === 'submit') {
    click.consumed = true;
    return true;
  }
  if (click.consumed || !isGenerated(step, NAVIGATE) || step.kind !== 'navigate') return false;
  const target = out[click.index];
  if (target && click.name) out[click.index] = { ...target, label: `Opened “${click.name}”` };
  click.consumed = true;
  return true;
}

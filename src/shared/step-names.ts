import { tidyStepName } from './step-label.ts';

/** A click and the navigation or form submission it caused land within this many ms of each other. */
export const FOLD_WINDOW_MS = 1000;

type NamedStep = { at: number; kind: string; label: string; auto?: boolean; folded?: true };

const CLICK_NAMED = /^Clicked [“"'](.+)[”"']$/s;
const CLICK_GENERIC = /^Clicked (?:button|link|field|tab|control)$/;
const SUBMIT = /^(?:Submitted form|Requested form submission|(?:Requested|Submitted) [“"'].+[”"'])$/s;
const NAVIGATE = /^Navigated(?: to another page)?$/;

type Click = { index: number; at: number; name: string; consumed: boolean };

function clicked(label: string): string | undefined {
  const name = CLICK_NAMED.exec(label)?.[1];
  return name === undefined ? undefined : tidyStepName(name);
}

/**
 * Compact, semantic labels for steps whose label was generated, not written. Click + navigation within a second
 * becomes "Opened “Projects”"; a form submission right after a click is absorbed the same way; a trailing colon or stray
 * whitespace in a quoted name is trimmed. An absorbed step is marked `folded: true`, not removed, so every step keeps its
 * index (saved `#step-N` links) and time. Pure and deterministic: a step with `auto: false`, an
 * unknown kind or a label outside the known generated patterns (anything a person typed) passes through as it is.
 */
export function normalizeSteps<T extends NamedStep>(steps: readonly T[]): T[] {
  const out: T[] = [];
  let click: Click | undefined;
  for (const step of steps) {
    const generated = step.auto !== false && ['click', 'submit', 'navigate'].includes(step.kind);
    const label = step.label.trim();
    const name = generated && step.kind === 'click' ? clicked(label) : undefined;
    if (name !== undefined || (generated && step.kind === 'click' && CLICK_GENERIC.test(label))) {
      const next = name ? { ...step, label: `Clicked “${name}”` } : step;
      out.push(next);
      click = { index: out.length - 1, at: step.at, name: name ?? '', consumed: false };
      continue;
    }
    const near = click && step.at - click.at >= 0 && step.at - click.at <= FOLD_WINDOW_MS ? click : undefined;
    if (generated && step.kind === 'submit' && SUBMIT.test(label) && near) {
      near.consumed = true;
      out.push({ ...step, folded: true });
      continue;
    }
    if (generated && step.kind === 'navigate' && NAVIGATE.test(label) && near && !near.consumed) {
      const target = out[near.index];
      if (target && near.name) out[near.index] = { ...target, label: `Opened “${near.name}”` };
      near.consumed = true;
      out.push({ ...step, folded: true });
      continue;
    }
    out.push(step);
    click = undefined;
  }
  return out;
}

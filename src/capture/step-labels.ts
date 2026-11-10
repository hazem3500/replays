import { tidyStepName } from '../shared/step-label.ts';
import type { RawStep } from './drivers/types.ts';

const NAMING_ATTRIBUTES = ['aria-label', 'title', 'alt', 'name', 'placeholder', 'data-tracking-id', 'data-testid'];

function quoted(value: string): string {
  return value
    .trim()
    .replace(/^(["'])(.*)\1$/s, '$2')
    .trim();
}

/** why: a partial selector names only a fragment, so the caption shows that uncertainty rather than inventing the rest. */
function partialName(name: string, operator: string | undefined): string {
  if (operator === '^=') return `${name}…`;
  if (operator === '$=') return `…${name}`;
  return operator === '=' ? name : `…${name}…`;
}

function attributeName(selector: string, attribute: string): string | undefined {
  const pattern = new RegExp(`\\[${attribute}\\s*([~|^$*]?=)\\s*("[^"]*"|'[^']*'|[^\\]\\s]+)\\s*(?:[is]\\s*)?\\]`, 'gi');
  const [, operator, raw = ''] = [...selector.matchAll(pattern)].at(-1) ?? [];
  const value = quoted(raw);
  if (!value) return;
  const name = attribute.startsWith('data-') || attribute === 'name' ? value.replace(/[-_]+/g, ' ').trim() : value;
  return partialName(name, operator);
}

/**
 * A readable name for a selector, for captions: `text=Save` → Save, `button[aria-label="Go to the Next Month"]` → Go to
 * the Next Month, `[data-tracking-id=holiday-calendar-add-date]` → holiday calendar add date. Undefined when the selector
 * names nothing a person would recognise.
 */
export function selectorName(selector: string): string | undefined {
  const text = /^text=(.+)$/s.exec(selector.trim());
  if (text) {
    const name = quoted(text[1] ?? '');
    return name === '' ? undefined : name;
  }
  for (const attribute of NAMING_ATTRIBUTES) {
    const name = attributeName(selector, attribute);
    if (name) return name;
  }
  const shown = /:has-text\((["'])(.+?)\1\)/.exec(selector)?.[2]?.trim();
  return shown === '' ? undefined : shown;
}

/** invariant: captions name only known control types, never ids, classes or selector syntax. */
function controlDescription(selector: string, field: boolean): string {
  if (field) return 'the field';
  const control = /(?:^|[\s>+~])(?:button|a|input|textarea|select)(?=[\s.#[:]|$)/gi;
  const tag = [...selector.matchAll(control)]
    .at(-1)?.[0]
    .trim()
    .replace(/^[>+~]\s*/, '')
    .toLowerCase();
  if (tag === 'button') return 'the button';
  if (tag === 'a') return 'the link';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'the field';
  return 'the control';
}

/** The step's caption: its own label, else one made from what it does and the control it names. */
export function labelFor(step: RawStep): string {
  if (step.label) return step.label;
  const named = 'selector' in step ? selectorName(step.selector) : undefined;
  const name = named ? tidyStepName(named) : undefined;
  const target = (field: boolean) => {
    if (name) return `“${name}”`;
    return 'selector' in step ? controlDescription(step.selector, field) : '';
  };
  switch (step.kind) {
    case 'click':
      return name ? `Click “${name}”` : `Click ${target(false)}`;
    case 'hover':
      return `Hover ${target(false)}`;
    case 'type':
      return `Type into ${target(true)}`;
    case 'fill':
      return `Fill ${target(true)}`;
    case 'press':
      return `Press ${step.key}`;
    case 'wait':
      return 'selector' in step ? `Wait for ${target(false)}` : 'Wait for the page';
    case 'scroll':
      return 'selector' in step ? `Scroll to ${target(false)}` : `Scroll ${step.direction}`;
    case 'goto':
      return `Open ${new URL(step.url).hostname}`;
    case 'shot':
      return `Screenshot “${step.name}”`;
  }
}

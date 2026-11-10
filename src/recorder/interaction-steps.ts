import { subscribeInteractionNavigation } from './interaction-navigation.ts';
import type { RawStep } from './bundle.ts';
import type { RecorderPrivacy } from './recorder-privacy.ts';
import { redactText } from './redact.ts';
import { tidyStepName } from './step-label.ts';

const MAX_STEPS = 500;
const REPEAT_MS = 350;
const CONTROL =
  'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"]';

function eventElement(event: Event): Element | undefined {
  return event.composedPath().find((node): node is Element => node instanceof Element);
}

const FIELD = 'input, select, textarea, [contenteditable]';

function readable(element: Element, privacy: RecorderPrivacy, blocked: string): boolean {
  return !element.closest(blocked) && !element.closest(FIELD) && !privacy.textMasked(element);
}

/** The first line of the first readable text node under `root`: what a person sees first, not all of it joined. */
function firstText(root: Element, privacy: RecorderPrivacy, blocked: string): string {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let count = 0, node = walker.nextNode(); node && count < 100; count++, node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !readable(parent, privacy, blocked)) continue;
    const line = (node.textContent ?? '').split('\n').find((part) => part.trim() !== '');
    if (line) return line;
  }
  return '';
}

function labelledBy(control: Element, privacy: RecorderPrivacy, blocked: string): string {
  const root = control.getRootNode() as Partial<Pick<Document, 'getElementById'>>;
  const names = (control.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  return names
    .map((id) => root.getElementById?.(id))
    .map((target) => (target && readable(target, privacy, blocked) ? firstText(target, privacy, blocked) : ''))
    .join(' ');
}

function humanized(value: string | null): string {
  const words = (value ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim();
  return /^[A-Za-z][A-Za-z ]{0,40}$/.test(words) ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : '';
}

/** The text of the `<label for>` or wrapping `<label>` of a field, or of its fieldset's legend. */
function fieldLabel(control: Element, privacy: RecorderPrivacy, blocked: string): string {
  const id = control.getAttribute('id');
  const labels = id ? Array.from(control.ownerDocument.querySelectorAll('label[for]')) : [];
  const label = labels.find((candidate) => candidate.getAttribute('for') === id) ?? control.closest('label');
  const legend = control.closest('fieldset')?.querySelector('legend');
  const names = [label, legend].map((element) =>
    element && readable(element, privacy, blocked) ? firstText(element, privacy, blocked) : '',
  );
  return names.find(Boolean) ?? '';
}

function innerName(control: Element, privacy: RecorderPrivacy, blocked: string): string {
  const inner = control.querySelector('[aria-label], img[alt]');
  if (!inner || inner.closest(blocked) || privacy.textMasked(inner)) return '';
  return inner.getAttribute('aria-label') ?? inner.getAttribute('alt') ?? '';
}

/**
 * invariant: a masked or blocked control names nothing, whichever source it would come from. A field is named by its
 * labels, never its value. The accessible name (aria-label, aria-labelledby, label, title) comes before visible text.
 */
function controlName(control: Element, privacy: RecorderPrivacy, blocked: string): string {
  const field = control.matches(FIELD);
  // why: rrweb never unmasks a field's own text, so a field is named by what surrounds it, under the same policy.
  if (privacy.textMasked(field ? (control.parentElement ?? undefined) : control) || control.closest(blocked)) return '';
  const sources = [
    () => control.getAttribute('aria-label'),
    () => labelledBy(control, privacy, blocked),
    () => (field ? fieldLabel(control, privacy, blocked) : ''),
    () => (field ? control.getAttribute('placeholder') : ''),
    () => control.getAttribute('title'),
    () => (field ? '' : firstText(control, privacy, blocked)),
    () => (field ? '' : innerName(control, privacy, blocked)),
    () => humanized(control.getAttribute('name')),
  ];
  const label = sources.map((source) => source()?.trim() ?? '').find(Boolean) ?? '';
  const withoutQueries = label.replace(/(?:https?:\/\/|\/)[^\s]*[?#][^\s]*/g, (url) => url.split(/[?#]/)[0] ?? '');
  return tidyStepName(redactText(withoutQueries, Number.MAX_SAFE_INTEGER));
}

function controlType(control: Element): string {
  if (control.matches('a[href], [role="link"]')) return 'link';
  if (control.matches('input, select, textarea')) return 'field';
  if (control.getAttribute('role') === 'tab') return 'tab';
  return 'button';
}

const TYPING_FIELD =
  'textarea, select, input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="file"])';

function clickLabel(control: Element, name: string): string {
  if (!name) return `Clicked ${controlType(control)}`;
  return `${control.matches(TYPING_FIELD) ? 'Focused' : 'Clicked'} “${name}”`;
}

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}

/** The last meaningful path segment of the page the route changed to, humanized: `/projects/` → Projects. */
export function routeNameOf(route: { hash: string; pathname: string }): string {
  const path = route.hash.startsWith('#/') ? route.hash.slice(1) : route.pathname;
  const segments = path.split(/[?#]/)[0]?.split('/').filter(Boolean) ?? [];
  if (!segments.length) return 'home';
  const words = humanized(decoded(segments.at(-1) ?? '').replace(/\.[a-z0-9]+$/i, ''));
  return words ? redactText(words, Number.MAX_SAFE_INTEGER) : '';
}

const routeName = () => routeNameOf(location);

export const FOLD_MS = 1000;

type Click = { step: RawStep; control: Element; at: number; consumed: boolean };

/** Adds bounded, privacy-aware action markers without retaining selectors, input values or navigation URLs. */
export function captureInteractionSteps(privacy: RecorderPrivacy, onStep: (step: RawStep) => void): () => void {
  const blocked = String(privacy.rrwebOptions().blockSelector);
  let active = true;
  let count = 0;
  let last: { target: Element; kind: string; at: number } | undefined;
  let click: Click | undefined;
  let route = location.href;
  const add = (target: Element, kind: string, label: string): RawStep | undefined => {
    if (!active || count >= MAX_STEPS) return;
    const at = Date.now();
    if (last?.target === target && last.kind === kind && at - last.at < REPEAT_MS) return;
    last = { target, kind, at };
    count++;
    const step: RawStep = { at, kind, label, auto: true };
    onStep(step);
    return step;
  };
  const recent = () => (click && !click.consumed && Date.now() - click.at <= FOLD_MS ? click : undefined);
  const onClick = (event: Event) => {
    const target = eventElement(event);
    if (!target || event.composedPath().some((node) => node instanceof Element && node.closest(blocked))) return;
    const control = target.closest(CONTROL);
    if (!control || control.closest(blocked)) return;
    const step = add(control, 'click', clickLabel(control, controlName(control, privacy, blocked)));
    click = step ? { step, control, at: step.at, consumed: false } : undefined;
  };
  const submit = (event: Event) => {
    const target = eventElement(event);
    if (!target || event.composedPath().some((node) => node instanceof Element && node.closest(blocked))) return;
    const submitter = event instanceof SubmitEvent ? event.submitter : null;
    const pending = recent();
    if (pending && submitter && pending.control === submitter) {
      pending.consumed = true;
      return;
    }
    const name = submitter ? controlName(submitter, privacy, blocked) : controlName(target, privacy, blocked);
    add(target, 'submit', name ? `Requested “${name}”` : 'Requested form submission');
  };
  const navigate = () => {
    if (!active || location.href === route) return;
    route = location.href;
    const page = routeName();
    const pending = recent();
    if (pending) {
      pending.consumed = true;
      const clicked = /^Clicked “(.+)”$/su.exec(pending.step.label)?.[1];
      if (clicked) pending.step.label = `Opened “${clicked}”`;
      else if (page) pending.step.label = `Opened ${page}`;
      return;
    }
    add(document.documentElement, 'navigate', page ? `Opened ${page}` : 'Navigated');
  };
  const stopNavigation = subscribeInteractionNavigation(navigate);
  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', submit, true);
  return () => {
    active = false;
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('submit', submit, true);
    stopNavigation();
  };
}

import { subscribeInteractionNavigation } from './interaction-navigation.ts';
import type { RawStep } from './bundle.ts';
import type { RecorderPrivacy } from './recorder-privacy.ts';
import { redactText } from './redact.ts';
import { capAtWord } from './step-label.ts';

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

/**
 * invariant: a masked, blocked or field control names nothing, whichever source it would come from; the accessible name
 * (aria-label, aria-labelledby, title) comes before the first line of text.
 */
function controlName(control: Element, privacy: RecorderPrivacy, blocked: string): string {
  if (control.matches(FIELD) || privacy.textMasked(control)) return '';
  const accessible = [control.getAttribute('aria-label'), labelledBy(control, privacy, blocked), control.getAttribute('title')]
    .map((name) => name?.trim() ?? '')
    .find(Boolean);
  const label = accessible ?? firstText(control, privacy, blocked);
  const withoutQueries = label.replace(/(?:https?:\/\/|\/)[^\s]*[?#][^\s]*/g, (url) => url.split(/[?#]/)[0] ?? '');
  return capAtWord(redactText(withoutQueries, Number.MAX_SAFE_INTEGER));
}

function controlType(control: Element): string {
  if (control.matches('a[href], [role="link"]')) return 'link';
  if (control.matches('input, select, textarea')) return 'field';
  if (control.getAttribute('role') === 'tab') return 'tab';
  return 'button';
}

/** Adds bounded, privacy-aware action markers without retaining selectors, input values or navigation URLs. */
export function captureInteractionSteps(privacy: RecorderPrivacy, onStep: (step: RawStep) => void): () => void {
  const blocked = String(privacy.rrwebOptions().blockSelector);
  let active = true;
  let count = 0;
  let last: { target: Element; kind: string; at: number } | undefined;
  let route = location.href;
  const add = (target: Element, kind: string, label: string) => {
    if (!active || count >= MAX_STEPS) return;
    const at = Date.now();
    if (last?.target === target && last.kind === kind && at - last.at < REPEAT_MS) return;
    last = { target, kind, at };
    count++;
    onStep({ at, kind, label });
  };
  const click = (event: Event) => {
    const target = eventElement(event);
    if (!target || event.composedPath().some((node) => node instanceof Element && node.closest(blocked))) return;
    const control = target.closest(CONTROL);
    if (!control || control.closest(blocked)) return;
    const name = controlName(control, privacy, blocked);
    add(control, 'click', name ? `Clicked “${name}”` : `Clicked ${controlType(control)}`);
  };
  const submit = (event: Event) => {
    const target = eventElement(event);
    if (!target || event.composedPath().some((node) => node instanceof Element && node.closest(blocked))) return;
    const submitter = event instanceof SubmitEvent ? event.submitter : null;
    const name = submitter ? controlName(submitter, privacy, blocked) : controlName(target, privacy, blocked);
    add(target, 'submit', name ? `Requested “${name}”` : 'Requested form submission');
  };
  const navigate = () => {
    if (!active || location.href === route) return;
    route = location.href;
    add(document.documentElement, 'navigate', 'Navigated');
  };
  const stopNavigation = subscribeInteractionNavigation(navigate);
  document.addEventListener('click', click, true);
  document.addEventListener('submit', submit, true);
  return () => {
    active = false;
    document.removeEventListener('click', click, true);
    document.removeEventListener('submit', submit, true);
    stopNavigation();
  };
}

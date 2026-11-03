import { subscribeInteractionNavigation } from './interaction-navigation.ts';
import type { RawStep } from './bundle.ts';
import type { RecorderPrivacy } from './recorder-privacy.ts';
import { redactText } from './redact.ts';

const MAX_STEPS = 500;
const REPEAT_MS = 350;
const CONTROL =
  'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"]';

function eventElement(event: Event): Element | undefined {
  return event.composedPath().find((node): node is Element => node instanceof Element);
}

function controlName(control: Element, privacy: RecorderPrivacy, blocked: string): string {
  if (control.matches('input, select, textarea, [contenteditable]') || privacy.textMasked(control)) return '';
  const walker = control.ownerDocument.createTreeWalker(control, NodeFilter.SHOW_TEXT);
  let text = '';
  for (let count = 0, node = walker.nextNode(); node && count < 100 && text.length < 120; count++, node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest(blocked) || parent.closest('input, select, textarea, [contenteditable]') || privacy.textMasked(parent))
      continue;
    text += ` ${node.textContent ?? ''}`;
  }
  const label = text.replace(/(?:https?:\/\/|\/)[^\s]*[?#][^\s]*/g, (url) => url.split(/[?#]/)[0] ?? '');
  return redactText(label.replace(/\s+/g, ' ').trim(), 80);
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
    add(target, 'submit', 'Submitted form');
  };
  const navigate = () => {
    if (!active || location.href === route) return;
    route = location.href;
    add(document.documentElement, 'navigate', 'Navigated to another page');
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

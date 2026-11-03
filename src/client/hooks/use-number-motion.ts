import { animate } from 'motion/mini';
import { useLayoutEffect, useRef } from 'react';

import { numberGlyphs } from '../components/number-parts.ts';
import { useMediaQuery } from '../media.ts';

const COALESCE_MS = 250;
let keyRepeatAt = Number.NEGATIVE_INFINITY;
let observers = 0;

function keyRepeat(event: KeyboardEvent) {
  if (event.repeat) keyRepeatAt = performance.now();
}

function observeKeyRepeat() {
  if (observers++ === 0) window.addEventListener('keydown', keyRepeat, { capture: true });
  return () => {
    if (--observers === 0) window.removeEventListener('keydown', keyRepeat, { capture: true });
  };
}

function glyphLayer(document: Document, text: string, className: string) {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

function rollingDigits(overlay: HTMLElement, before: number, value: number) {
  const previous = new Map(numberGlyphs(before).map((glyph) => [glyph.key, glyph.text]));
  const direction = value >= before ? 1 : -1;
  const controls: ReturnType<typeof animate>[] = [];
  for (const glyph of numberGlyphs(value)) {
    const old = previous.get(glyph.key);
    const holder = glyphLayer(overlay.ownerDocument, '', 'number-glyph');
    holder.append(glyphLayer(overlay.ownerDocument, glyph.text, 'number-glyph-space'));
    const incoming = glyphLayer(overlay.ownerDocument, glyph.text, 'number-glyph-layer');
    holder.append(incoming);
    overlay.append(holder);
    if (old === glyph.text) continue;
    const distance = glyph.digit ? 100 : 0;
    controls.push(
      animate(
        [incoming],
        {
          transform: [`translateY(${direction * distance}%)`, 'translateY(0%)'],
          opacity: [0, 1],
        },
        { duration: 0.24, ease: [0.23, 1, 0.32, 1] },
      ),
    );
    if (old === undefined) continue;
    const outgoing = glyphLayer(overlay.ownerDocument, old, 'number-glyph-layer');
    holder.append(outgoing);
    controls.push(
      animate(
        [outgoing],
        {
          transform: ['translateY(0%)', `translateY(${-direction * distance}%)`],
          opacity: [1, 0],
        },
        { duration: 0.24, ease: [0.23, 1, 0.32, 1] },
      ),
    );
  }
  return controls;
}

function numberTransitionSuppressed(now: number, previousAt: number, value: number, previous: number) {
  return now - previousAt < COALESCE_MS || now - keyRepeatAt < COALESCE_MS || !Number.isFinite(value) || !Number.isFinite(previous);
}

/** Decorative rollers never change the native final text, its accessibility, or its intrinsic layout width. */
export function useNumberMotion(value: number, text: string, instant: boolean) {
  const wrapper = useRef<HTMLSpanElement>(null);
  const memory = useRef({ value, text, at: 0 });
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useLayoutEffect(observeKeyRepeat, []);
  useLayoutEffect(() => {
    const previous = memory.current;
    if (Object.is(previous.value, value) && previous.text === text) return;
    const now = performance.now();
    memory.current = { value, text, at: now };
    const root = wrapper.current;
    const overlay = root?.querySelector<HTMLElement>('.number-motion');
    const plain = root?.querySelector<HTMLElement>('.number-static');
    if (
      !root ||
      !overlay ||
      !plain ||
      instant ||
      reduced ||
      typeof root.animate !== 'function' ||
      numberTransitionSuppressed(now, previous.at, value, previous.value)
    )
      return;
    const controls = rollingDigits(overlay, previous.value, value);
    if (controls.length === 0) {
      overlay.replaceChildren();
      return;
    }
    plain.style.setProperty('opacity', '0');
    let active = true;
    const finish = () => {
      if (!active) return;
      overlay.replaceChildren();
      plain.style.removeProperty('opacity');
    };
    void Promise.all(controls.map((control) => control.finished)).then(finish, finish);
    return () => {
      active = false;
      for (const control of controls) control.cancel();
      overlay.replaceChildren();
      plain.style.removeProperty('opacity');
    };
  }, [value, text, instant, reduced]);
  return wrapper;
}

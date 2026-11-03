// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { TooltipPositionMotion } from '../src/client/components/ui/surface-motion.tsx';
import { settle } from './settle.ts';

let host: HTMLDivElement;
let root: Root;
let animations: MockInstance<Element['animate']>;

/** Base UI's positioner writes: the open state, then inline placement. */
function place(positioner: HTMLElement, top: number, left: number) {
  positioner.style.setProperty('top', `${top}px`);
  positioner.style.setProperty('left', `${left}px`);
}

/** Lets the hook's MutationObserver see the writes. */
const observed = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Animation frames run only when a test says a frame has passed, so a slow machine cannot settle the tooltip early. */
let queued: FrameRequestCallback[] = [];
function frames(count: number) {
  for (let frame = 0; frame < count; frame++) {
    const due = queued;
    queued = [];
    for (const callback of due) callback(performance.now());
  }
}

function geometryAnimations() {
  return animations.mock.calls.filter(([keyframes]) => keyframes && ['top', 'left'].some((key) => key in keyframes));
}

async function openPositioner() {
  await settle(() => root.render(createElement(TooltipPositionMotion)));
  const positioner = host.firstElementChild;
  if (!(positioner instanceof HTMLElement)) throw new Error('expected the positioner to mount');
  positioner.setAttribute('data-open', '');
  place(positioner, 0, 0);
  await observed();
  place(positioner, 412, 640);
  await observed();
  return positioner;
}

describe('tooltip position motion', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    queued = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => queued.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    animations = vi.spyOn(HTMLElement.prototype, 'animate');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await settle(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('places an opening tooltip at its measured position instead of flying in from the provisional one', async () => {
    const positioner = await openPositioner();
    expect(geometryAnimations()).toHaveLength(0);
    expect(positioner.style.getPropertyValue('top')).toBe('412px');
    expect(positioner.style.getPropertyValue('left')).toBe('640px');
  });

  it('glides to a neighbouring trigger once the open tooltip has settled', async () => {
    const positioner = await openPositioner();
    frames(3);
    place(positioner, 412, 700);
    await observed();
    expect(geometryAnimations()).toHaveLength(1);
  });
});

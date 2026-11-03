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

function geometryAnimations() {
  return animations.mock.calls.filter(([keyframes]) => keyframes && ['top', 'left'].some((key) => key in keyframes));
}

/** Base UI's viewport during a switch between triggers: the outgoing label stays over the incoming one. */
function switchLabels(positioner: HTMLElement) {
  const outgoing = document.createElement('div');
  outgoing.setAttribute('data-previous', '');
  positioner.querySelector('.tip-morph-viewport')?.prepend(outgoing);
}

async function openPositioner() {
  const label = createElement('div', { 'data-current': '' }, 'Highlight this moment');
  const viewport = createElement('div', { className: 'tip-morph-viewport' }, label);
  await settle(() => root.render(createElement(TooltipPositionMotion, null, viewport)));
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

  it('places a reopened tooltip without gliding from where it last closed', async () => {
    const positioner = await openPositioner();
    positioner.removeAttribute('data-open');
    await observed();
    positioner.setAttribute('data-open', '');
    place(positioner, 120, 980);
    await observed();
    expect(geometryAnimations()).toHaveLength(0);
  });

  it('glides when it switches to a neighbouring trigger while showing', async () => {
    const positioner = await openPositioner();
    switchLabels(positioner);
    place(positioner, 412, 700);
    await observed();
    expect(geometryAnimations()).toHaveLength(1);
  });
});

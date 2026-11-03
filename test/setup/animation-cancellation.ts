import { afterAll, beforeEach } from 'vitest';

const restorations: Array<() => void> = [];
const installed = new WeakSet<object>();

function isAnimate(value: unknown): value is Element['animate'] {
  return typeof value === 'function';
}

function observeCancellation(animation: Animation, Cancellation: typeof DOMException) {
  // why: Happy DOM eagerly creates native finished promises; Motion owns a separate completion promise.
  void animation.finished.catch((error: unknown) => {
    if (!(error instanceof Cancellation) || error.name !== 'AbortError') throw error;
  });
}

// oxlint-disable-next-line vitest/require-top-level-describe -- why: Vitest setupFiles hooks must register globally for every test module.
beforeEach(() => {
  if (typeof window === 'undefined' || typeof window.Element !== 'function') return;
  const prototype = window.Element.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'animate');
  const original: unknown = descriptor?.value;
  if (!descriptor || !isAnimate(original) || installed.has(original)) return;
  const animate: Element['animate'] = function (this: Element, ...args) {
    const animation = original.apply(this, args);
    const Cancellation = this.ownerDocument.defaultView?.DOMException ?? window.DOMException;
    observeCancellation(animation, Cancellation);
    const cancel = animation.cancel.bind(animation);
    animation.cancel = () => {
      observeCancellation(animation, Cancellation);
      cancel();
    };
    return animation;
  };
  installed.add(animate);
  Object.defineProperty(prototype, 'animate', { ...descriptor, value: animate });
  restorations.push(() => {
    if (Object.getOwnPropertyDescriptor(prototype, 'animate')?.value === animate) Object.defineProperty(prototype, 'animate', descriptor);
  });
});

// oxlint-disable-next-line vitest/require-top-level-describe -- why: Vitest setupFiles hooks must register globally for every test module.
afterAll(() => {
  for (const restore of restorations.splice(0).toReversed()) restore();
});

import { vi } from 'vitest';

class SyncResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe() {
    this.callback([], this);
  }
  disconnect() {}
  unobserve() {}
}

/** Gives timeline rulers a width and a synchronous ResizeObserver under happy-dom; returns the restore function. */
export function stubRulerLayout() {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('tl-ruler') ? 340 : 0;
    },
  });
  vi.stubGlobal('ResizeObserver', SyncResizeObserver);
  return () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  };
}

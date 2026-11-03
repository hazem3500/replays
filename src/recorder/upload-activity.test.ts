// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUploadActivity } from './upload-activity.ts';

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
describe('upload activity motion', () => {
  afterEach(() => {
    if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate);
    else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    vi.unstubAllGlobals();
  });

  it('keeps progress indeterminate and stops activity when reduced motion changes or the surface leaves', () => {
    const preference = new EventTarget();
    let reduced = false;
    Object.defineProperty(preference, 'matches', { get: () => reduced });
    vi.stubGlobal('matchMedia', () => preference);
    const cancellations: Array<ReturnType<typeof vi.fn<() => void>>> = [];
    const animate = vi.fn<HTMLElement['animate']>(() => {
      const animation = new Animation();
      Object.defineProperty(animation, 'playState', { configurable: true, value: 'running' });
      const cancel = vi.fn<() => void>();
      animation.cancel = cancel;
      cancellations.push(cancel);
      return animation;
    });
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    const activity = createUploadActivity('Sending');
    expect(activity.node.querySelector('progress')?.getAttribute('aria-label')).toBe('Sending');
    expect(activity.node.querySelector('progress')?.hasAttribute('value')).toBe(false);
    expect(animate).toHaveBeenCalledTimes(2);
    reduced = true;
    preference.dispatchEvent(new Event('change'));
    expect(cancellations.every((cancel) => cancel.mock.calls.length === 1)).toBe(true);
    const fill = activity.node.querySelector<HTMLElement>('.upload-activity-fill');
    expect(fill?.style.transform).toBe('');
    expect(fill?.style.opacity).toBe('');
    activity.stop();
    reduced = false;
    preference.dispatchEvent(new Event('change'));
    expect(animate).toHaveBeenCalledTimes(2);
  });
});

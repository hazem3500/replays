// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startRecordingPulse } from './recording-pulse.ts';

function dotWithAnimations() {
  const dot = document.createElement('span');
  const cancellations: Array<ReturnType<typeof vi.fn<() => void>>> = [];
  const animate = vi.fn<HTMLElement['animate']>(() => {
    const animation = new Animation();
    Object.defineProperty(animation, 'playState', { configurable: true, value: 'running' });
    const cancel = vi.fn<() => void>();
    animation.cancel = cancel;
    cancellations.push(cancel);
    return animation;
  });
  dot.animate = animate;
  return { dot, animate, cancellations };
}

describe('recording status pulse', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stops for reduced motion, resumes only while mounted and cleans its preference listener', () => {
    const preference = new EventTarget();
    let reduced = false;
    Object.defineProperty(preference, 'matches', { get: () => reduced });
    vi.stubGlobal('matchMedia', () => preference);
    const { dot, animate, cancellations } = dotWithAnimations();
    const stop = startRecordingPulse(dot);
    expect(animate).toHaveBeenCalledOnce();
    reduced = true;
    preference.dispatchEvent(new Event('change'));
    expect(cancellations[0]).toHaveBeenCalledOnce();
    expect(dot.style.opacity).toBe('');
    reduced = false;
    preference.dispatchEvent(new Event('change'));
    expect(animate).toHaveBeenCalledTimes(2);
    stop();
    expect(cancellations[1]).toHaveBeenCalledOnce();
    preference.dispatchEvent(new Event('change'));
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it('keeps the recording marker still when reduced motion is already requested', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { dot, animate } = dotWithAnimations();
    const stop = startRecordingPulse(dot);
    expect(animate).not.toHaveBeenCalled();
    expect(dot.style.opacity).toBe('');
    stop();
  });
});

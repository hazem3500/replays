// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hideSurface, showSurface } from './surface-motion.ts';

function animatedShell() {
  const shell = document.createElement('div');
  const animations: Array<{ finish: () => void; cancel: ReturnType<typeof vi.fn> }> = [];
  const animate = vi.fn<HTMLElement['animate']>(() => {
    const cancel = vi.fn<() => void>();
    const animation = new Animation();
    Object.defineProperty(animation, 'playState', { configurable: true, value: 'running' });
    animation.cancel = cancel;
    animations.push({ finish: () => animation.onfinish?.call(animation, new Event('finish') as AnimationPlaybackEvent), cancel });
    return animation;
  });
  shell.animate = animate;
  return { shell, animations, animate };
}

describe('Recorder surface motion', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the exiting surface visible but inert until its animation finishes', async () => {
    const { shell, animations } = animatedShell();
    showSurface(shell);
    shell.dataset.phase = 'recording';
    hideSurface(shell);
    expect(shell.hidden).toBe(false);
    expect(shell.inert).toBe(true);
    expect(shell.getAttribute('aria-hidden')).toBe('true');
    for (const animation of animations.slice(2)) animation.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(shell.hidden).toBe(true);
  });

  it('cancels a pending exit when upload reuses the recording shell', async () => {
    const { shell, animations } = animatedShell();
    showSurface(shell);
    shell.dataset.phase = 'recording';
    hideSurface(shell);
    showSurface(shell);
    for (const animation of animations.slice(2)) expect(animation.cancel).toHaveBeenCalledOnce();
    for (const animation of animations.slice(2)) animation.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(shell.hidden).toBe(false);
    expect(shell.inert).toBe(false);
    expect(shell.hasAttribute('aria-hidden')).toBe(false);
    expect(animations).toHaveLength(4);
  });

  it('removes a dismissed surface only after its exit finishes', async () => {
    const { shell, animations } = animatedShell();
    const remove = vi.fn<() => void>();
    hideSurface(shell, remove);
    expect(remove).not.toHaveBeenCalled();
    for (const animation of animations) animation.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('skips animations and hides immediately when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { shell, animate } = animatedShell();
    showSurface(shell);
    hideSurface(shell);
    expect(animate).not.toHaveBeenCalled();
    expect(shell.hidden).toBe(true);
  });
});

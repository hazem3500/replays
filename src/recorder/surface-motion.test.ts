// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hideSurface, showSurface } from './surface-motion.ts';
import { must } from './testing.ts';

function animatedShell() {
  const shell = document.createElement('div');
  const animations: Array<{ finish: () => void; cancel: ReturnType<typeof vi.fn> }> = [];
  const animate = vi.fn<HTMLElement['animate']>(() => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const cancel = vi.fn<() => void>();
    animations.push({ finish, cancel });
    const animation = new Animation();
    Object.defineProperty(animation, 'finished', { value: finished });
    animation.cancel = cancel;
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
    must(animations[1]).finish();
    await Promise.resolve();
    expect(shell.hidden).toBe(true);
  });

  it('cancels a pending exit when upload reuses the recording shell', async () => {
    const { shell, animations } = animatedShell();
    showSurface(shell);
    shell.dataset.phase = 'recording';
    hideSurface(shell);
    showSurface(shell);
    expect(must(animations[1]).cancel).toHaveBeenCalledOnce();
    must(animations[1]).finish();
    await Promise.resolve();
    expect(shell.hidden).toBe(false);
    expect(shell.inert).toBe(false);
    expect(shell.hasAttribute('aria-hidden')).toBe(false);
    expect(animations).toHaveLength(2);
  });

  it('removes a dismissed surface only after its exit finishes', async () => {
    const { shell, animations } = animatedShell();
    const remove = vi.fn<() => void>();
    hideSurface(shell, remove);
    expect(remove).not.toHaveBeenCalled();
    must(animations[0]).finish();
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

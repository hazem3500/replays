// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { hideSurface, showSurface } from './surface-motion.ts';

afterEach(() => vi.unstubAllGlobals());

function animatedShell() {
  const shell = document.createElement('div');
  const animations: Array<{ finish: () => void; cancel: ReturnType<typeof vi.fn> }> = [];
  shell.animate = vi.fn<HTMLElement['animate']>(() => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const cancel = vi.fn<() => void>();
    animations.push({ finish, cancel });
    return { finished, cancel } as unknown as Animation;
  });
  return { shell, animations };
}

it('keeps the exiting surface visible but inert until its animation finishes', async () => {
  const { shell, animations } = animatedShell();
  showSurface(shell);
  shell.dataset.phase = 'recording';
  hideSurface(shell);
  expect(shell.hidden).toBe(false);
  expect(shell.inert).toBe(true);
  expect(shell.getAttribute('aria-hidden')).toBe('true');
  animations[1]!.finish();
  await Promise.resolve();
  expect(shell.hidden).toBe(true);
});

it('cancels a pending exit when upload reuses the recording shell', async () => {
  const { shell, animations } = animatedShell();
  showSurface(shell);
  shell.dataset.phase = 'recording';
  hideSurface(shell);
  showSurface(shell);
  expect(animations[1]!.cancel).toHaveBeenCalledOnce();
  animations[1]!.finish();
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
  animations[0]!.finish();
  await Promise.resolve();
  expect(remove).toHaveBeenCalledOnce();
});

it('skips animations and hides immediately when reduced motion is requested', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const { shell } = animatedShell();
  showSurface(shell);
  hideSurface(shell);
  expect(shell.animate).not.toHaveBeenCalled();
  expect(shell.hidden).toBe(true);
});

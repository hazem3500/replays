import { describe, expect, it, vi } from 'vitest';

import { settleAnimations } from '../src/client/playback/settle-animations.ts';

function fakeAnimation(playState: string, iterations: number, duration = 200) {
  return {
    playState,
    effect: { getComputedTiming: () => ({ iterations, duration }) },
    finish: vi.fn(),
  };
}

function docWith(animations: ReturnType<typeof fakeAnimation>[]) {
  return { getAnimations: () => animations } as unknown as Document;
}

describe('settleAnimations', () => {
  it('finishes running enter animations so a seeked modal is not stuck at its first frame', () => {
    const fadeIn = fakeAnimation('running', 1);
    const transition = fakeAnimation('running', 1, 150);
    settleAnimations(docWith([fadeIn, transition]));
    expect(fadeIn.finish).toHaveBeenCalledOnce();
    expect(transition.finish).toHaveBeenCalledOnce();
  });

  it('leaves infinite, finished and idle animations alone', () => {
    const spinner = fakeAnimation('running', Infinity);
    const done = fakeAnimation('finished', 1);
    const idle = fakeAnimation('idle', 1);
    settleAnimations(docWith([spinner, done, idle]));
    expect(spinner.finish).not.toHaveBeenCalled();
    expect(done.finish).not.toHaveBeenCalled();
    expect(idle.finish).not.toHaveBeenCalled();
  });

  it('keeps going when one animation refuses to finish', () => {
    const stuck = fakeAnimation('running', 1);
    stuck.finish.mockImplementation(() => {
      throw new Error('no');
    });
    const next = fakeAnimation('running', 1);
    settleAnimations(docWith([stuck, next]));
    expect(next.finish).toHaveBeenCalledOnce();
  });

  it('ignores a missing document', () => {
    expect(() => settleAnimations(null)).not.toThrow();
    expect(() => settleAnimations({} as Document)).not.toThrow();
  });
});

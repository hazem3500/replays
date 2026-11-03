// @vitest-environment happy-dom
import { act, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useShuffle } from '../src/client/hooks/use-suite-shuffle.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Motion {
  element: HTMLElement;
  finish: () => void;
  cancel: () => void;
  frames: Keyframe[];
}

let host: HTMLDivElement;
let root: Root;
let motions: Motion[];

function Harness({ step, view = 'grid', count = 3 }: { step: number; view?: string; count?: number }) {
  const ref = useRef<HTMLLIElement>(null);
  const capture = useShuffle(ref, step, view);
  return createElement(
    'li',
    { 'data-view': view, 'data-stack-front': `run-${step % count}` },
    createElement(
      'button',
      // oxlint-disable-next-line react/refs -- why: createElement stores the event handler; the closed-over ref is read only on click.
      {
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
          ref.current = event.currentTarget.closest('li');
          capture();
        },
      },
      'Capture',
    ),
    createElement(
      'div',
      { className: 'suite-sheet' },
      createElement(
        'span',
        { className: 'shuffle-window' },
        ...Array.from({ length: Math.min(6, count - 1) }, (_, index) =>
          createElement('span', {
            key: index,
            className: `card-back card-back-${index + 1}`,
            'data-run-id': `run-${(step + index + 1) % count}`,
            'data-stack-depth': index + 1,
            'data-stack-reserve': index >= 5 ? '' : undefined,
            style: {
              transform: `translateY(-${(index + 1) * 6}px) scale(${1 - (index + 1) * 0.05})`,
              opacity: index >= 5 ? 0 : 1 - (index + 1) * 0.15,
            },
          }),
        ),
        createElement('span', { className: 'poster' }, createElement('img', { alt: 'Run thumbnail' })),
      ),
      createElement('div', { className: 'feed-body' }, 'Suite information'),
    ),
  );
}

function render(step: number, view = 'grid', count = 3) {
  act(() => root.render(createElement(Harness, { step, view, count })));
}

function setUp() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  motions = [];
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal(
    'Animation',
    class {
      finished: Promise<void>;
      onfinish: (() => void) | null = null;
      playState = 'running';
      currentTime = 0;
      playbackRate = 1;
      startTime = 0;
      effect = { getComputedTiming: () => ({ duration: 300, endTime: 300 }), updateTiming: () => {} };
      play() {}
      pause() {}
      commitStyles() {}
      finish: () => void = () => {
        throw new Error('Animation has not started');
      };
      cancel = vi.fn<() => void>();
      constructor() {
        this.finished = new Promise<void>((resolve, reject) => {
          this.finish = () => {
            this.playState = 'finished';
            this.onfinish?.();
            resolve();
          };
          this.cancel.mockImplementation(() => reject(new Error('Animation cancelled')));
        });
        void this.finished.catch(() => {});
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, 'animate').mockImplementation(function (this: HTMLElement, frames) {
    const animation = new Animation();
    const values = Array.isArray(frames)
      ? frames
      : [0, 1].map((index) =>
          Object.fromEntries(Object.entries(frames ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value[index] : value])),
        );
    motions.push({ element: this, finish: () => animation.finish(), cancel: vi.spyOn(animation, 'cancel'), frames: values });
    return animation;
  });
}

function tearDown() {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
}

function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected the shuffle target');
  return value;
}

describe('Suite shuffle', () => {
  beforeEach(setUp);
  afterEach(tearDown);
  for (const count of [2, 3, 4, 6, 9]) {
    it(`advances each thumbnail plane and returns the old front to the back for ${count} runs`, async () => {
      render(0, 'grid', count);
      const poses = [...host.querySelectorAll<HTMLElement>('.card-back')].map((back) => back.style.transform);
      const rearPose = poses[0];
      act(() => present(host.querySelector('button')).click());
      render(1, 'grid', count);
      const outgoing = present(host.querySelector<HTMLElement>('.poster-outgoing'));
      expect(outgoing.style.zIndex).toBe('9');
      expect(outgoing.querySelector('img')).not.toBeNull();
      expect(outgoing.querySelector('.feed-body')).toBeNull();
      expect(motions.every(({ element }) => !element.classList.contains('suite-sheet') && !element.classList.contains('feed-body'))).toBe(
        true,
      );
      expect(host.querySelector('.feed-body')?.textContent).toBe('Suite information');
      const frontMotion = present(
        motions.find(
          ({ element, frames }) =>
            element.classList.contains('poster') &&
            !element.classList.contains('poster-outgoing') &&
            frames.some((frame) => frame.transform !== undefined),
        ),
      );
      expect(frontMotion.frames[0]?.transform).toBe(rearPose);
      for (const motion of motions.filter(
        ({ element, frames }) => element.classList.contains('card-back') && frames.some((frame) => frame.transform !== undefined),
      )) {
        const depth = Number(motion.element.dataset.stackDepth);
        expect(motion.frames[0]?.transform).toBe(poses[depth]);
        expect(motion.frames[1]?.transform).toBe(motion.element.style.transform);
        expect(motion.frames[0]?.transform).not.toBe(motion.frames[1]?.transform);
      }
      const deepestOldVisibleId = `run-${Math.min(count - 1, 5)}`;
      expect(motions.some(({ element }) => element.dataset.runId === deepestOldVisibleId)).toBe(count > 2);
      const returningSheet = host.querySelector<HTMLElement>('[data-run-id="run-0"]');
      expect(returningSheet?.style.visibility).toBe(count <= 7 ? 'hidden' : undefined);

      await act(async () => {
        present(motions[0]).finish();
        await Promise.resolve();
      });
      expect(outgoing.style.zIndex).toBe('0');
      const returns = motions.filter(({ element }) => element === outgoing).slice(1);
      const returning = present(returns.find(({ frames }) => frames.some((frame) => frame.transform !== undefined)));
      expect(returning.frames.at(-1)?.transform).toBe(
        present(returningSheet ?? host.querySelector<HTMLElement>('.card-back-6')).style.transform,
      );
      const opacity = present(returns.find(({ frames }) => frames.some((frame) => frame.opacity !== undefined)));
      expect(Number(opacity.frames.at(-1)?.opacity)).toBe(
        Number(present(returningSheet ?? host.querySelector<HTMLElement>('.card-back-6')).style.opacity),
      );
      await act(async () => {
        for (const motion of returns) motion.finish();
        await Promise.resolve();
      });
      expect(host.querySelector('.poster-outgoing')).toBeNull();
      expect(returningSheet?.style.visibility).toBe(count <= 7 ? '' : undefined);
    });
  }
});

describe('Suite shuffle cancellation', () => {
  beforeEach(setUp);
  afterEach(tearDown);

  for (const action of ['view switch', 'hover leave'] as const) {
    it(`cancels every sheet on ${action} without starting its return phase`, async () => {
      render(0);
      act(() => present(host.querySelector('button')).click());
      render(1);
      const first = [...motions];
      if (action === 'view switch') render(1, 'list');
      else render(0);
      await act(async () => {
        present(first[0]).finish();
        await Promise.resolve();
      });
      for (const motion of first) expect(motion.cancel).toHaveBeenCalled();
      expect(motions).toHaveLength(first.length);
      expect(host.querySelector('.poster-outgoing')).toBeNull();
      expect(host.querySelector<HTMLElement>('[data-run-id="run-0"]')?.style.visibility ?? '').toBe('');
    });
  }

  it('changes the thumbnail without moving any plane under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(0);
    act(() => present(host.querySelector('button')).click());
    render(1);
    expect(motions).toHaveLength(0);
    expect(host.querySelector('.poster-outgoing')).toBeNull();
  });
});

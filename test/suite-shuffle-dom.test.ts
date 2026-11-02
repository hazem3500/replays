// @vitest-environment happy-dom
import { act, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useShuffle } from '../src/client/index/suite-cycle.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Motion {
  element: HTMLElement;
  finish: () => void;
  cancel: () => void;
}

let host: HTMLDivElement;
let root: Root;
let motions: Motion[];

function Harness({ step, view = 'grid' }: { step: number; view?: string }) {
  const ref = useRef<HTMLLIElement>(null);
  const capture = useShuffle(ref, step, view);
  return createElement(
    'li',
    { 'data-view': view },
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
    createElement('div', { className: 'suite-sheet' }, 'Live run'),
  );
}

function render(step: number, view = 'grid') {
  act(() => root.render(createElement(Harness, { step, view })));
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
      finish: () => void = () => {
        throw new Error('Animation has not started');
      };
      cancel = vi.fn<() => void>();
      constructor() {
        this.finished = new Promise<void>((resolve, reject) => {
          this.finish = resolve;
          this.cancel.mockImplementation(() => reject(new Error('Animation cancelled')));
        });
        void this.finished.catch(() => undefined);
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, 'animate').mockImplementation(function (this: HTMLElement) {
    const animation = new Animation();
    motions.push({ element: this, finish: () => animation.finish(), cancel: animation.cancel });
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
  it('returns the outgoing sheet behind the live front only after its downward phase finishes', async () => {
    render(0);
    act(() => present(host.querySelector('button')).click());
    render(1);
    const outgoing = present(host.querySelector<HTMLElement>('.suite-sheet-outgoing'));
    expect(outgoing.style.zIndex).toBe('3');
    expect(motions).toHaveLength(2);

    await act(() => present(motions[0]).finish());

    expect(outgoing.style.zIndex).toBe('1');
    expect(host.querySelector<HTMLElement>('.suite-sheet:not(.suite-sheet-outgoing)')?.style.zIndex).toBe('2');
    expect(motions).toHaveLength(3);
    expect(present(motions[2]).element).toBe(outgoing);
    await act(() => present(motions[2]).finish());
    expect(host.querySelector('.suite-sheet-outgoing')).toBeNull();
  });

  it('cancels a pending shuffle on a view switch without starting its return phase', async () => {
    render(0);
    act(() => present(host.querySelector('button')).click());
    render(1);
    const first = [...motions];

    render(1, 'list');
    await act(() => present(first[0]).finish());

    for (const motion of first) expect(motion.cancel).toHaveBeenCalledOnce();
    expect(motions).toHaveLength(2);
    expect(host.querySelector('.suite-sheet-outgoing')).toBeNull();
    expect(host.querySelector<HTMLElement>('.suite-sheet')?.style.zIndex).toBe('');
  });
});

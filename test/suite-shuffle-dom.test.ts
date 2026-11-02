// @vitest-environment happy-dom
import { act, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useShuffle } from '../src/client/index/suite-cycle.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Motion {
  element: HTMLElement;
  finish: () => void;
  cancel: ReturnType<typeof vi.fn>;
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

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  motions = [];
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(HTMLElement.prototype, 'animate').mockImplementation(function (this: HTMLElement) {
    let finish!: () => void;
    let reject!: (reason: Error) => void;
    const finished = new Promise<void>((resolve, rejectPromise) => {
      finish = resolve;
      reject = rejectPromise;
    });
    void finished.catch(() => undefined);
    const cancel = vi.fn<() => void>(() => reject(new Error('Animation cancelled')));
    motions.push({ element: this, finish, cancel });
    return { finished, cancel } as unknown as Animation;
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('returns the outgoing sheet behind the live front only after its downward phase finishes', async () => {
  render(0);
  act(() => host.querySelector('button')!.click());
  render(1);
  const outgoing = host.querySelector<HTMLElement>('.suite-sheet-outgoing')!;
  expect(outgoing.style.zIndex).toBe('3');
  expect(motions).toHaveLength(2);

  await act(async () => motions[0]!.finish());

  expect(outgoing.style.zIndex).toBe('1');
  expect(host.querySelector<HTMLElement>('.suite-sheet:not(.suite-sheet-outgoing)')?.style.zIndex).toBe('2');
  expect(motions).toHaveLength(3);
  expect(motions[2]!.element).toBe(outgoing);
  await act(async () => motions[2]!.finish());
  expect(host.querySelector('.suite-sheet-outgoing')).toBeNull();
});

it('cancels a pending shuffle on a view switch without starting its return phase', async () => {
  render(0);
  act(() => host.querySelector('button')!.click());
  render(1);
  const first = [...motions];

  render(1, 'list');
  await act(async () => first[0]!.finish());

  expect(first.every((motion) => motion.cancel.mock.calls.length === 1)).toBe(true);
  expect(motions).toHaveLength(2);
  expect(host.querySelector('.suite-sheet-outgoing')).toBeNull();
  expect(host.querySelector<HTMLElement>('.suite-sheet')?.style.zIndex).toBe('');
});

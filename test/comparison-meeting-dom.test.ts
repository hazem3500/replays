// @vitest-environment happy-dom
import { act, createElement, type ReactNode, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingRoom } from '../src/client/comparison/meeting/MeetingRoom.tsx';
import { MeetingWorkspace } from '../src/client/comparison/meeting/MeetingWorkspace.tsx';
import type { MeetingSearch } from '../src/client/comparison/meeting/url.ts';
import { performanceFixture } from './performance-fixture.ts';

interface FakeReplayer {
  id: string;
  playing: boolean;
  destroyed: boolean;
}
const evidence = vi.hoisted(() => ({ players: [] as FakeReplayer[], observers: [] as Array<(visible: boolean) => void> }));

// why: rrweb rebuilds pages in iframes, which happy-dom cannot load; everything above it (player, clock, UI) is real.
vi.mock('rrweb', () => ({
  Replayer: class {
    id: string;
    playing = false;
    destroyed = false;
    time = 0;
    wrapper: HTMLDivElement;
    iframe: HTMLDivElement;
    constructor(_events: unknown, { root }: { root: HTMLElement }) {
      this.id = root.closest<HTMLElement>('.mt-tile')?.dataset.tileId ?? '';
      this.wrapper = document.createElement('div');
      this.iframe = document.createElement('div');
      this.wrapper.append(this.iframe);
      root.append(this.wrapper);
      evidence.players.push(this);
    }
    on() {}
    play(offset?: number) {
      if (offset !== undefined) this.time = offset;
      this.playing = true;
    }
    pause(offset?: number) {
      if (offset !== undefined) this.time = offset;
      this.playing = false;
    }
    getCurrentTime() {
      return this.time;
    }
    setConfig() {}
    destroy() {
      this.destroyed = true;
      this.wrapper.remove();
    }
  },
}));

const live = (id: string) => evidence.players.find((player) => player.id === id && !player.destroyed)!;

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
let changes: MeetingSearch[];

function bundle(id: string, duration: number, errorsAt: number[] = []) {
  const value = performanceFixture();
  value.meta.id = id;
  value.meta.duration = duration;
  value.meta.title = `Recording ${id}`;
  value.meta.viewport = { width: 1280, height: 800 };
  value.events = [{ timestamp: 0 }, { timestamp: duration }] as typeof value.events;
  value.console = errorsAt.map((at) => ({ at, level: 'error', message: `boom ${at}` })) as typeof value.console;
  value.network = [];
  return value;
}

const tiles = () => [...host.querySelectorAll<HTMLElement>('.mt-tile')];
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}
async function mount(element: ReactNode) {
  const page = createElement(StrictMode, null, element, createElement(Toaster));
  await act(async () => root.render(createElement(QueryClientProvider, { client }, page)));
  await settle();
}
async function render(search: MeetingSearch) {
  await mount(createElement(MeetingWorkspace, { search, onSearchChange: (next: MeetingSearch) => void changes.push(next) }));
}
/** The room as a suite hosts it: its runs as tiles, the arrangement owned by the caller. */
async function renderRoom(search: MeetingSearch) {
  await mount(
    createElement(MeetingRoom, {
      search,
      runs: { ids: ['a', 'b', 'c'], labels: { a: 'Run 1', b: 'Run 2', c: 'Run 3' } },
      onSearchChange: (next: MeetingSearch) => void changes.push(next),
      title: 'Nightly',
      backHref: '/',
      shareHref: () => '/',
      mobile: false,
    }),
  );
}
const layout = () => host.querySelector('.mt-stage-area')?.getAttribute('data-layout');
const players = () => evidence.players.filter((player) => !player.destroyed);
/** The recording the diagnostics dock shows. */
const shown = () => host.querySelector<HTMLElement>('.mt-dock [role="radio"][aria-checked="true"]')?.dataset.sourceId;
/** Opens a tile's "⋯" menu and chooses the item labelled `text`. */
async function choose(tile: HTMLElement, text: string) {
  await act(async () => tile.querySelector<HTMLButtonElement>('button[aria-label^="More for"]')!.click());
  await settle();
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.textContent === text);
  await act(async () => item!.click());
  await settle();
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700);
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private readonly callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element) {
        const report = (visible: boolean) =>
          this.callback([{ isIntersecting: visible, target } as IntersectionObserverEntry], this as never);
        evidence.observers.push(report);
        report(true);
      }
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('Not found', { status: 404 })),
  );
  evidence.players.length = 0;
  evidence.observers.length = 0;
  changes = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  for (const [id, duration, errors] of [
    ['a', 6000, [1000]],
    ['b', 9000, []],
    ['c', 4000, [2000]],
  ] as const)
    client.setQueryData(['replay', id], bundle(id, duration, [...errors]));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  client.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('meeting workspace', () => {
  it('mounts one player per tile on one shared timeline, with merged colour-coded markers', async () => {
    await render({ ids: ['a', 'b', 'c'] });
    expect(tiles().map((tile) => tile.dataset.tileId)).toEqual(['a', 'b', 'c']);
    const mounted = evidence.players.filter((player) => !player.destroyed);
    expect(mounted.map((player) => player.id).toSorted()).toEqual(['a', 'b', 'c']);
    expect(host.querySelector('.mt-range')?.getAttribute('max')).toBe('9000');
    expect(host.querySelectorAll('.mt-markers i')).toHaveLength(2);
    expect(tiles().every((tile) => tile.style.width && tile.style.transform.startsWith('translate('))).toBe(true);
  });

  it('pins a tile into the spotlight without remounting any player, and Escape returns to the grid', async () => {
    await render({ ids: ['a', 'b', 'c'] });
    const before = evidence.players.filter((player) => !player.destroyed);
    await act(async () => tiles()[1]!.querySelector<HTMLButtonElement>('button[aria-label="Spotlight"]')!.click());
    expect(host.querySelector('.mt-stage-area')?.getAttribute('data-layout')).toBe('spotlight');
    expect(tiles()[1]!.dataset.role).toBe('spotlight');
    expect(changes.at(-1)).toMatchObject({ ids: ['a', 'b', 'c'], pin: 'b' });
    expect(evidence.players.filter((player) => !player.destroyed)).toEqual(before);
    await act(async () => tiles()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('.mt-stage-area')?.getAttribute('data-layout')).toBe('grid');
  });

  it('offers Back to grid on the tile in the spotlight', async () => {
    await render({ ids: ['a', 'b', 'c'], pin: 'b' });
    await act(async () => tiles()[1]!.querySelector<HTMLButtonElement>('button[aria-label="Back to grid"]')!.click());
    expect(layout()).toBe('grid');
    expect(changes.at(-1)).not.toHaveProperty('pin');
  });

  it('hides tiles and their seek bar markers from the ⋯ menu, keeping the URL in step', async () => {
    await render({ ids: ['a', 'b', 'c'] });
    await choose(tiles()[2]!, 'Hide from comparison');
    expect(tiles()).toHaveLength(2);
    expect(host.querySelectorAll('.mt-markers i')).toHaveLength(1);
    await choose(tiles()[0]!, 'Hide markers from the seek bar');
    expect(host.querySelectorAll('.mt-markers i')).toHaveLength(0);
    expect(changes.at(-1)).toMatchObject({ hide: ['c'], mute: ['a'] });
    await act(async () => button('Show Recording c').click());
    expect(tiles()).toHaveLength(3);
  });

  it('undoes hiding a tile from the toast', async () => {
    await render({ ids: ['a', 'b', 'c'] });
    await choose(tiles()[1]!, 'Hide from comparison');
    expect(tiles()).toHaveLength(2);
    const undo = [...document.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent === 'Undo');
    await act(async () => undo!.click());
    expect(tiles().map((tile) => tile.dataset.tileId)).toEqual(['a', 'b', 'c']);
    expect(changes.at(-1)).not.toHaveProperty('hide');
  });

  it('plays every tile from Space, holds a shorter one at its end and announces it', async () => {
    await render({ ids: ['a', 'b'], align: { b: -1500 } });
    expect(tiles()[1]!.dataset.state).toBe('waiting');
    expect(tiles()[1]!.querySelector('.mt-overlay')?.textContent).toBe('Starts in 1.5s');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })));
    expect(live('a').playing).toBe(true);
    await act(async () =>
      host.querySelector<HTMLInputElement>('.mt-range')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })),
    );
    expect(tiles()[0]!.dataset.state).toBe('ended');
    expect(tiles()[0]!.querySelector('.mt-overlay')?.textContent).toBe('Ended');
    expect(host.querySelector('[role="status"][aria-live="polite"]')?.textContent).toContain('A, Recording a: ended');
  });

  it('pauses off-screen tiles and resyncs them when they scroll back', async () => {
    await render({ ids: ['a', 'b'] });
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })));
    expect(live('b').playing).toBe(true);
    const reportB = evidence.observers.at(-1)!;
    await act(async () => reportB(false));
    expect(live('b').playing).toBe(false);
    await act(async () => reportB(true));
    expect(live('b').playing).toBe(true);
  });

  it('switches grid and spotlight from the layout switch without remounting a player', async () => {
    await render({ ids: ['a', 'b', 'c'] });
    const before = players();
    await act(async () => host.querySelector<HTMLButtonElement>('[role="radio"][data-layout="spotlight"]')!.click());
    expect(layout()).toBe('spotlight');
    expect(tiles()[0]!.dataset.role).toBe('spotlight');
    expect(changes.at(-1)).toMatchObject({ pin: 'a' });
    expect(players()).toEqual(before);
  });

  it('follows a layout its host chooses, keeping every player', async () => {
    await renderRoom({});
    const before = players();
    expect(layout()).toBe('grid');
    await renderRoom({ pin: 'b' });
    expect(layout()).toBe('spotlight');
    expect(tiles()[1]!.dataset.role).toBe('spotlight');
    await renderRoom({});
    expect(layout()).toBe('grid');
    expect(players()).toEqual(before);
  });

  it('labels a suite’s tiles with its run names and reports a pin without listing the runs', async () => {
    await renderRoom({});
    expect(tiles().map((tile) => tile.querySelector('.mt-label')?.textContent)).toEqual(['Run 1', 'Run 2', 'Run 3']);
    await act(async () => tiles()[2]!.querySelector<HTMLButtonElement>('button[aria-label="Spotlight"]')!.click());
    expect(changes.at(-1)).toEqual({ pin: 'c' });
  });

  it('shows the diagnostics of one recording at a time and flips it without changing the layout', async () => {
    await renderRoom({});
    expect(shown()).toBe('a');
    await act(async () => host.querySelector<HTMLButtonElement>('.mt-dock [data-source-id="c"]')!.click());
    expect(shown()).toBe('c');
    expect(layout()).toBe('grid');
    expect(players()).toHaveLength(3);
  });

  it('points the diagnostics at a tile when it is clicked or put in the spotlight', async () => {
    await renderRoom({});
    await act(async () => tiles()[1]!.focus());
    expect(shown()).toBe('b');
    await act(async () => tiles()[2]!.querySelector<HTMLButtonElement>('button[aria-label="Spotlight"]')!.click());
    expect(shown()).toBe('c');
  });

  it('moves focus between tiles with arrow keys', async () => {
    await render({ ids: ['a', 'b', 'c'] });
    tiles()[0]!.focus();
    await act(async () => tiles()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(document.activeElement).toBe(tiles()[1]);
  });
});

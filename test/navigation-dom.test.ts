// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/client/intent-prefetch.ts', () => ({ setClientNavigation: vi.fn() }));
vi.mock('../src/client/ViewerSkeleton.tsx', () => ({ OPEN_HINT_KEY: 'replays-open-hint' }));

type Navigation = typeof import('../src/client/navigation.ts');
type Trip = { update: () => Promise<void>; finish: () => void; old: Element[]; skip: ReturnType<typeof vi.fn> };
let nav: Navigation;
let trips: Trip[];
let reduced: boolean;
let scroll: number;
let unsubscribe: () => void;
let removeListeners: () => void;

const named = () => [...document.querySelectorAll<HTMLElement>('*')].filter((node) => node.style.viewTransitionName === 'vt-hero');
const tick = () => vi.advanceTimersByTimeAsync(0);

function geometry(element: Element, width: number, height: number, hidden = () => false) {
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => new DOMRect(16, 120, hidden() ? 0 : width, hidden() ? 0 : height));
}

function decoded(image: HTMLImageElement, width = 1280, height = 720) {
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
    decode: { configurable: true, value: vi.fn(() => Promise.resolve()) },
  });
  image.dispatchEvent(new Event('load'));
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  history.replaceState(null, '', '/');
  document.body.innerHTML = '';
  sessionStorage.clear();
  trips = [];
  reduced = false;
  scroll = 420;
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
  vi.stubGlobal('scrollY', 420);
  vi.spyOn(window, 'scrollTo').mockImplementation((x?: number | ScrollToOptions, y?: number) => {
    scroll = typeof x === 'object' ? (x.top ?? 0) : (y ?? 0);
    vi.stubGlobal('scrollY', scroll);
  });
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: vi.fn((update: () => Promise<void>) => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const skip = vi.fn();
    trips.push({ update, finish, old: named(), skip });
    return { ready: Promise.resolve(), finished, skipTransition: skip } as unknown as ViewTransition;
  }) });
  nav = await import('../src/client/navigation.ts');
  const windowEvents = vi.spyOn(window, 'addEventListener');
  const documentEvents = vi.spyOn(document, 'addEventListener');
  nav.installNavigation();
  // Module resets do not remove event listeners; keep every test's router isolated.
  const windowCalls = [...windowEvents.mock.calls];
  const documentCalls = [...documentEvents.mock.calls];
  removeListeners = () => {
    for (const [type, listener, options] of windowCalls) window.removeEventListener(type, listener, options);
    for (const [type, listener, options] of documentCalls) document.removeEventListener(type, listener, options);
  };
  unsubscribe = () => {};
});

afterEach(() => {
  unsubscribe();
  removeListeners();
  document.body.innerHTML = '';
  delete document.documentElement.dataset.pageTransition;
  Reflect.deleteProperty(document, 'startViewTransition');
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function indexFixture(href: string, view: 'list' | 'grid') {
  const poster = `<span class="poster poster-${view === 'grid' ? 'card' : 'row'}" data-phase="ready"><img src="/fixture.png"></span>`;
  const card = (id: string) => `<li class="feed-item" data-entry-id="${id}">${view === 'list' ? `<span class="stack-front">${poster}</span>` : poster}<a class="row-target" href="${href}">${id}</a></li>`;
  // Both cards address the same route. The second clicked card must be the return destination.
  document.body.innerHTML = `<div class="index-shell"><ul>${card('first')}${card('origin')}</ul></div><div id="viewer"></div>`;
  const index = document.querySelector<HTMLElement>('.index-shell')!;
  for (const element of index.querySelectorAll('.poster, .row-target')) geometry(element, 160, 100, () => index.hidden);
  for (const image of index.querySelectorAll('img')) decoded(image);
  const link = index.querySelector<HTMLAnchorElement>('[data-entry-id="origin"] a')!;
  unsubscribe = nav.subscribeRoute(() => {
    index.hidden = nav.currentRoute().kind !== 'index';
    const viewer = document.querySelector('#viewer')!;
    viewer.innerHTML = index.hidden ? '<main class="app-shell"><div id="replay-player" tabindex="-1"><div class="player-frame"><iframe></iframe></div></div></main>' : '';
    const frame = viewer.querySelector('.player-frame');
    if (frame) geometry(frame, 640, 360);
  });
  await tick();
  return link;
}

async function land(trip: Trip) {
  await trip.update();
  trip.finish();
  await tick();
}

function popToIndex() {
  history.replaceState(null, '', '/');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

describe('navigation ownership and round-trip state', () => {
  it.each([
    ['/r/sample', 'list'],
    ['/r/sample', 'grid'],
    ['/s/sample/r/run-2', 'list'],
    ['/s/sample', 'grid'],
  ] as const)('returns %s (%s) to the exact source card and scroll position', async (href, view) => {
    const link = await indexFixture(href, view);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    nav.navigate(href, { clicked: link });
    expect(trips[0]!.old[0]?.closest('[data-entry-id]')?.getAttribute('data-entry-id')).toBe('origin');
    await land(trips[0]!);
    expect(scroll).toBe(0);
    expect(document.activeElement?.id).toBe('replay-player');
    // All replays consumes the pushed history entry; emulate its browser pop event deterministically.
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    nav.navigate('/');
    expect(back).toHaveBeenCalledOnce();
    popToIndex();
    expect(trips[1]!.old[0]?.className).toBe('player-frame');
    await trips[1]!.update();
    expect(named()[0]?.closest('[data-entry-id]')?.getAttribute('data-entry-id')).toBe('origin');
    expect(scroll).toBe(420);
    trips[1]!.finish();
    await tick();
    expect(document.activeElement).toBe(link);
    expect(named()).toEqual([]);
  });

  it('does not let a cancelled callback clear a newer trip’s source name', async () => {
    const link = await indexFixture('/r/sample', 'list');
    nav.navigate('/r/sample', { clicked: link });
    const cancelled = trips[0]!;
    // Back before the update commits cancels the pending trip.
    popToIndex();
    nav.navigate('/r/sample', { clicked: link });
    const current = trips[1]!;
    expect(named()).toEqual(current.old);
    await cancelled.update();
    cancelled.finish();
    await tick();
    expect(nav.currentRoute().kind).toBe('index');
    expect(named()).toEqual(current.old);
    await land(current);
    expect(nav.currentRoute()).toEqual({ kind: 'replay', id: 'sample' });
    expect(named()).toEqual([]);
    expect(document.documentElement.dataset.pageTransition).toBeUndefined();
  });

  it('bounds unresolved route preparation at 80ms', async () => {
    const link = await indexFixture('/r/sample', 'list');
    nav.setRoutePreparer(() => new Promise(() => {}));
    nav.navigate('/r/sample', { clicked: link });
    const trip = trips[0]!;
    const update = trip.update();
    await vi.advanceTimersByTimeAsync(79);
    expect(nav.currentRoute().kind).toBe('index');
    await vi.advanceTimersByTimeAsync(1);
    await update;
    expect(nav.currentRoute().kind).toBe('replay');
    trip.finish();
    await tick();
  });

  it.each(['undecoded', 'portrait', 'video'] as const)('uses the page fallback for an %s source', async (kind) => {
    const link = await indexFixture('/r/sample', 'list');
    const poster = link.closest('.feed-item')!.querySelector('.poster')!;
    const image = poster.querySelector('img')!;
    if (kind === 'undecoded') {
      image.src = '/pending-decode.png';
      Object.defineProperty(image, 'decode', { configurable: true, value: () => new Promise(() => {}) });
    } else if (kind === 'portrait') {
      Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 300 });
      Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 600 });
      nav.rememberListed([{ id: 'sample', steps: 2, viewport: { width: 1280, height: 720 } }]);
    } else {
      poster.insertAdjacentHTML('beforeend', '<video class="poster-video" data-shown></video>');
      vi.spyOn(poster.querySelector('video')!, 'pause').mockImplementation(() => {});
    }
    nav.navigate('/r/sample', { clicked: link });
    expect(trips[0]!.old).toEqual([]);
    await land(trips[0]!);
    expect(nav.currentRoute().kind).toBe('replay');
    expect(named()).toEqual([]);
  });

  it('skips View Transitions and forced stage focus for reduced-motion touch navigation', async () => {
    reduced = true;
    const link = await indexFixture('/r/sample', 'grid');
    window.dispatchEvent(new Event('pointerdown'));
    nav.navigate('/r/sample', { clicked: link });
    await tick();
    expect(nav.currentRoute().kind).toBe('replay');
    expect(document.activeElement?.id).not.toBe('replay-player');
    popToIndex();
    await tick();
    expect(scroll).toBe(420);
    expect(document.activeElement).not.toBe(link);
    expect(trips).toHaveLength(0);
  });
});

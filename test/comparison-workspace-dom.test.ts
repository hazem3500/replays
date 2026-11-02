// @vitest-environment happy-dom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PairWorkspace as ComparisonWorkspace } from '../src/client/comparison/ComparisonWorkspace.tsx';
import { performanceFixture } from './performance-fixture.ts';

interface TestPlayer {
  id: string;
  duration: number;
  time: number;
  status: 'paused' | 'playing';
  skipInactive: boolean;
  destroyed: boolean;
  scrubs: number;
  ends: number;
}
const evidence = vi.hoisted(() => ({ players: [] as TestPlayer[], failMount: '' }));

// These tests exercise real workspace/coordinator/cache ownership. rrweb rendering is deliberately mocked.
vi.mock('../src/client/player.ts', () => ({
  SPEEDS: [0.5, 1, 1.5, 2],
  ReplayController: class {
    id: string;
    duration: number;
    time = 0;
    status: 'paused' | 'playing' = 'paused';
    skipInactive = true;
    destroyed = false;
    scrubs = 0;
    ends = 0;
    constructor(recording: ReturnType<typeof performanceFixture>) {
      this.id = recording.meta.id;
      this.duration = recording.meta.duration;
      evidence.players.push(this);
    }
    mount(root: HTMLElement) {
      if (evidence.failMount === this.id) throw new Error('Test mount failed');
      const frame = document.createElement('iframe');
      frame.dataset.recording = this.id;
      root.append(frame);
      return () => {
        this.destroyed = true;
        frame.remove();
      };
    }
    getViewport() {
      return { width: 1000, height: 700 };
    }
    subscribeViewport() {
      return () => {};
    }
    getTime() {
      return this.time;
    }
    getState() {
      return { status: this.status };
    }
    seek(time: number) {
      this.time = time;
    }
    play() {
      this.status = 'playing';
    }
    pause() {
      this.status = 'paused';
    }
    setSpeed() {}
    setSkipInactive(value: boolean) {
      this.skipInactive = value;
    }
    beginScrub() {
      this.scrubs++;
    }
    endScrub() {
      this.ends++;
    }
  },
}));
vi.mock('../src/client/theme.tsx', async () => {
  const { createElement: element } = await import('react');
  return { ThemeSwitch: () => element('button', { type: 'button' }, 'Theme') };
});

vi.mock('../src/client/Topbar.tsx', () => ({
  Topbar: ({ menuItems = [] }: { menuItems: { label: string; onSelect(): void }[] }) =>
    createElement(
      'header',
      null,
      ...menuItems.map((item) => createElement('button', { key: item.label, onClick: item.onSelect }, item.label)),
    ),
}));

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
let fetcher: ReturnType<typeof vi.fn>;
function bundle(id: string, duration = 10000) {
  const value = performanceFixture();
  value.meta.id = id;
  value.meta.duration = duration;
  value.meta.title = `Recording ${id}`;
  value.events = [{ timestamp: 0 }, { timestamp: duration }];
  value.console = [];
  value.network = [];
  return value;
}
function find<T extends HTMLElement = HTMLElement>(selector: string): T {
  const value = host.querySelector<T>(selector);
  expect(value).not.toBeNull();
  return value!;
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function click(selector: string) {
  await act(async () => find(selector).click());
}
async function change(selector: string, value: string) {
  await act(async () => {
    const element = find<HTMLInputElement | HTMLSelectElement>(selector);
    const setter = Object.getOwnPropertyDescriptor(
      element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function render(beforeId = 'before', afterId = 'after', strict = false) {
  const element = createElement(ComparisonWorkspace, { beforeId, afterId });
  await act(async () =>
    root.render(createElement(QueryClientProvider, { client }, strict ? createElement(StrictMode, null, element) : element)),
  );
  await settle();
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Playback ownership is asserted here; deterministic clock progression has its own suite.
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn<(callback: FrameRequestCallback) => number>(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn<(handle: number) => void>());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-width: 720px)',
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  fetcher = vi.fn<typeof fetch>(async () => new Response('Not found', { status: 404 }));
  vi.stubGlobal('fetch', fetcher);
  evidence.players.length = 0;
  evidence.failMount = '';
  localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});

describe('comparison workspace ownership and evidence', () => {
  it('uses two independent controllers from existing cached bundles and keeps both mounted through phone switching', async () => {
    client.setQueryData(['replay', 'before'], bundle('before'));
    client.setQueryData(['replay', 'after'], bundle('after', 15000));
    await render();
    expect(fetcher).not.toHaveBeenCalled();
    expect(evidence.players).toHaveLength(2);
    expect(host.querySelectorAll('input[type="range"]')).toHaveLength(1);
    expect(evidence.players.map((player) => player.skipInactive)).toEqual([false, false]);
    await act(async () =>
      find('#comparison-timeline').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })),
    );
    await act(async () => find('#comparison-timeline').dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })));
    expect(evidence.players.map((player) => player.time)).toEqual([1000, 1000]);
    expect(host.querySelector('.cmp-phone-switch')).toBeNull();
    expect(find('#comparison-source-a').getAttribute('aria-hidden')).toBeNull();
    expect(find('#comparison-source-b').getAttribute('aria-hidden')).toBeNull();
    expect(host.querySelectorAll('.cmp-player-host iframe')).toHaveLength(2);
    expect(evidence.players).toHaveLength(2);
    expect(evidence.players.every((player) => !player.destroyed)).toBe(true);
    expect(evidence.players.map((player) => player.time)).toEqual([1000, 1000]);
  });

  it('leaves A usable while B loads, fails and retries independently through replayQuery', async () => {
    client.setQueryData(['replay', 'before'], bundle('before'));
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    await render();
    expect(evidence.players.map((player) => player.id)).toEqual(['before']);
    expect(find('#comparison-source-b').textContent).toContain('Loading B');
    await act(async () => {
      resolve(new Response('failure', { status: 500 }));
    });
    await settle();
    expect(find('#comparison-source-b [role="alert"]').textContent).toContain('500');
    await click('[aria-label="Play both recordings"]');
    expect(evidence.players[0]!.status).toBe('playing');
    await click('[aria-label="Pause both recordings"]');
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(bundle('after')), { status: 200 }));
    await click('#comparison-source-b .cmp-load-state button');
    await settle();
    expect(evidence.players.map((player) => player.id)).toEqual(['before', 'after']);
    expect(evidence.players[0]!.destroyed).toBe(false);
    expect(fetcher.mock.calls.every(([path]) => path === '/api/replays/after')).toBe(true);
  });

  it('isolates mount failure and retries only that player', async () => {
    evidence.failMount = 'after';
    client.setQueryData(['replay', 'before'], bundle('before'));
    client.setQueryData(['replay', 'after'], bundle('after'));
    await render();
    expect(find('#comparison-source-b [role="alert"]').textContent).toContain('Test mount failed');
    expect(evidence.players[0]!.destroyed).toBe(false);
    evidence.failMount = '';
    await click('#comparison-source-b .cmp-side-error button');
    expect(host.querySelectorAll('.cmp-player-host iframe')).toHaveLength(2);
    expect(evidence.players[0]!.destroyed).toBe(false);
  });

  it('replaces only B with a cached workspace recording and disposes players when leaving', async () => {
    client.setQueryData(['replay', 'before'], bundle('before'));
    client.setQueryData(['replay', 'after'], bundle('after'));
    client.setQueryData(['replay', 'later'], bundle('later'));
    await render();
    const originalA = evidence.players[0]!;
    const originalB = evidence.players[1]!;
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Comparison settings')!.click());
    await change('#comparison-id-b', 'later');
    await act(async () =>
      find('#comparison-id-b')
        .closest('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    await settle();
    expect(originalA.destroyed).toBe(false);
    expect(originalB.destroyed).toBe(true);
    expect(evidence.players.filter((player) => !player.destroyed).map((player) => player.id)).toEqual(['before', 'later']);
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => root.render(null));
    expect(evidence.players.every((player) => player.destroyed && player.status === 'paused')).toBe(true);
  });

  it('applies explicit B offsets, maps error jumps and opens captured request detail', async () => {
    const after = bundle('after');
    after.network = [
      {
        id: 'failed',
        at: 3000,
        duration: 200,
        method: 'POST',
        url: 'https://captured.example/payment',
        status: 503,
        statusText: 'Unavailable',
        requestHeaders: [],
        responseHeaders: [],
      },
    ];
    client.setQueryData(['replay', 'before'], bundle('before'));
    client.setQueryData(['replay', 'after'], after);
    await render();
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Comparison settings')!.click());
    await change('.cmp-offset input', '1');
    await act(async () => find('.cmp-offset').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(evidence.players.map((player) => player.time)).toEqual([0, 1000]);
    await change('.cmp-marker-picker select', 'b-network-0');
    expect(evidence.players.map((player) => player.time)).toEqual([2000, 3000]);
    expect(find('.cmp-selected-error').textContent).toContain('https://captured.example/payment');
    expect(find('.cmp-selected-error').textContent).toContain('503');
    expect(document.activeElement).toBe(find('.cmp-selected-error h3'));
    const reset = [...host.querySelectorAll<HTMLButtonElement>('.cmp-offset button')].find(
      (button) => button.textContent === 'Reset offset',
    )!;
    await act(async () => reset.click());
    expect(evidence.players.map((player) => player.time)).toEqual([2000, 2000]);
  });

  it('keeps suggestions informational and persists customization per task layout', async () => {
    const before = bundle('before');
    before.console = [{ level: 'error', at: 1000, message: 'actual captured failure' }];
    client.setQueryData(['replay', 'before'], before);
    client.setQueryData(['replay', 'after'], bundle('after'));
    await render();
    expect(find('.cmp-workspace').dataset.layout).toBe('performance');
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Comparison settings')!.click());
    expect(find('.cmp-layout-toolbar p').textContent).toContain('Debugging may help');
    await click('.cmp-panel-controls fieldset:first-child input');
    expect(JSON.parse(localStorage.getItem('replays-comparison-layouts-v1:/')!).layouts.performance.panels[0].visible).toBe(false);
    await change('.cmp-layout-toolbar select', 'design');
    expect(find('.cmp-workspace').dataset.canvasSize).toBe('large');
    expect(find('#context-panel')).toBeDefined();
    await change('.cmp-layout-toolbar select', 'performance');
    expect(JSON.parse(localStorage.getItem('replays-comparison-layouts-v1:/')!).layouts.performance.panels[0].visible).toBe(false);
    expect(JSON.parse(localStorage.getItem('replays-comparison-layouts-v1:/')!).layouts.performance.panels[0].visible).toBe(false);
  });

  it('discloses absent performance and original semantics; uses recorded step captions for walkthrough', async () => {
    const before = bundle('before');
    delete before.performance;
    client.setQueryData(['replay', 'before'], before);
    client.setQueryData(['replay', 'after'], bundle('after'));
    await render();
    expect(find('[data-panel="performance"]').textContent).toContain('Not recorded');
    expect(find('[data-panel="performance"]').textContent).toContain('No historical FPS');
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Comparison settings')!.click());
    expect(find('.cmp-semantics').textContent).toContain('saved cuts');
    await change('.cmp-layout-toolbar select', 'walkthrough');
    expect(host.querySelectorAll('.cmp-caption')).toHaveLength(2);
    expect(find('.cmp-caption').textContent).toContain('Open projects');
    expect(find('.cmp-panels > section').dataset.panel).toBe('journey');
  });

  it('rejects external initial sources without fetching them and survives StrictMode cleanup', async () => {
    client.setQueryData(['replay', 'before'], bundle('before'));
    await render('before', 'https://external.example/r/private', true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(find('#comparison-source-b [role="alert"]').textContent).toContain('External URLs are not loaded');
    expect(evidence.players.filter((player) => !player.destroyed).map((player) => player.id)).toEqual(['before']);
    expect(find('#comparison-source-a .cmp-side-clock').textContent).toContain('Paused');
  });

  it('flushes keyboard scrubbing and suppresses resume when focus leaves the window', async () => {
    client.setQueryData(['replay', 'before'], bundle('before'));
    client.setQueryData(['replay', 'after'], bundle('after'));
    await render();
    await click('[aria-label="Play both recordings"]');
    await act(async () =>
      find('#comparison-timeline').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })),
    );
    expect(evidence.players.map((player) => player.status)).toEqual(['paused', 'paused']);
    await act(async () => window.dispatchEvent(new Event('blur')));
    expect(evidence.players.every((player) => player.scrubs === 1 && player.ends === 1)).toBe(true);
    expect(find('[aria-label="Play both recordings"]')).toBeDefined();
  });
  it('expands either recording and returns to gallery without remounting or losing the shared seek', async () => {
    client.setQueryData(['replay', 'before'], bundle('before'));
    client.setQueryData(['replay', 'after'], bundle('after'));
    await render();
    const original = [...evidence.players];
    await act(async () =>
      find('#comparison-timeline').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })),
    );
    await act(async () => find('#comparison-timeline').dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })));
    await click('[aria-label="Expand After recording"]');
    expect(find('.cmp-stages').dataset.spotlight).toBe('b');
    expect(find('#comparison-source-a').getAttribute('aria-hidden')).toBeNull();
    expect(evidence.players).toEqual(original);
    expect(evidence.players.map((player) => player.time)).toEqual([1000, 1000]);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(find('.cmp-stages').hasAttribute('data-spotlight')).toBe(false);
    expect(evidence.players.every((player) => !player.destroyed)).toBe(true);
  });
  it('confirms two scenario origins and preserves real local time while retaining both players', async () => {
    client.setQueryData(['replay', 'before'], bundle('before', 10000));
    client.setQueryData(['replay', 'after'], bundle('after', 15000));
    await render();
    const original = [...evidence.players];
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Comparison settings')!.click());
    const fields = host.querySelectorAll<HTMLInputElement>('.cmp-scenario-alignment input');
    await change('.cmp-scenario-alignment fieldset:first-child input', '1.5');
    await change('.cmp-scenario-alignment fieldset:last-child input', '2.5');
    await act(async () => find('.cmp-scenario-alignment').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(evidence.players).toEqual(original);
    expect(evidence.players.map((player) => player.time)).toEqual([1500, 2500]);
    expect(find<HTMLInputElement>('#comparison-timeline').value).toBe('0');
    expect(find<HTMLInputElement>('#comparison-timeline').max).toBe('12500');
    expect(find('.cmp-scenario-alignment [role="status"]').textContent).toContain('original playback speed is unchanged');
    expect(fields[0]!.value).toBe('1.5');
    await act(async () =>
      find('#comparison-timeline').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })),
    );
    await act(async () => find('#comparison-timeline').dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })));
    expect(evidence.players.map((player) => player.time)).toEqual([2500, 3500]);
  });
});

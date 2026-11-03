// @vitest-environment happy-dom
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReplayProvider, ReplayTransport, ReplaySteps, ReplayInspector, useReplayTime } from '../src/client/compose/index.ts';
import { ReplayController, type Playback } from '../src/client/playback/index.ts';
import { NO_EFFECTS, type PlaybackEffects } from '../src/shared/effects.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import { settle } from './settle.ts';

function recording(id: string, duration = 5000): ReplayBundle {
  return {
    meta: {
      id,
      title: id,
      url: 'https://example.test',
      capturedAt: '2026-11-02T00:00:00Z',
      duration,
      viewport: { width: 800, height: 600 },
      eventCount: 2,
      version: 1,
    },
    events: [{ timestamp: 1000 }, { timestamp: duration + 1000 }],
    console: [{ at: 2400, level: 'error', message: '<script>retained as text</script>' }],
    network: [],
    steps: [
      { at: 0, kind: 'start', label: 'Open page' },
      { at: 2000, kind: 'click', label: 'Save changes' },
    ],
  };
}

function Time() {
  const time = useReplayTime();
  return <output data-time>{String(time)}</output>;
}

function consumer(bundle: ReplayBundle, playback?: Playback, effects?: PlaybackEffects) {
  return (
    <ReplayProvider bundle={bundle} {...(playback ? { playback } : {})} {...(effects ? { effects } : {})}>
      <ReplayTransport />
      <ReplaySteps />
      <Time />
    </ReplayProvider>
  );
}

function isSaveButton(button: HTMLButtonElement) {
  return button.textContent?.startsWith('Save changes');
}

function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected the consumer element');
  return value;
}

let host: HTMLDivElement;
let root: Root;

function setUp() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
}

async function tearDown() {
  await settle(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
}

describe('composable replay clocks', () => {
  beforeEach(setUp);
  afterEach(tearDown);

  it('keeps two providers independent while native steps and external actions share each provider clock', async () => {
    const first = recording('first');
    const second = recording('second');
    const playback = new ReplayController(first);
    await settle(() =>
      root.render(
        <main>
          <section data-instance="one">{consumer(first, playback)}</section>
          <section data-instance="two">{consumer(second)}</section>
        </main>,
      ),
    );
    const one = present(host.querySelector('[data-instance="one"]'));
    const two = present(host.querySelector('[data-instance="two"]'));
    await settle(() => playback.seek(1200));
    expect(one.querySelector('[data-time]')?.textContent).toBe('1200');
    expect(two.querySelector('[data-time]')?.textContent).toBe('0');
    const save = present([...two.querySelectorAll('button')].find(isSaveButton));
    await settle(() => save.click());
    expect(two.querySelector('[data-time]')?.textContent).toBe('2000');
    expect(save.getAttribute('aria-current')).toBe('step');
    expect(one.querySelector('[data-time]')?.textContent).toBe('1200');
    await settle(() => playback.setSpeed(2));
    expect(present(one.querySelector('select')).value).toBe('2');
    expect(present(two.querySelector('select')).value).toBe('1');
  });

  it('replaces an owned recording without retaining the old recording playhead or duration', async () => {
    const first = recording('first');
    await settle(() => root.render(consumer(first)));
    await settle(() => present([...host.querySelectorAll('button')].find(isSaveButton)).click());
    expect(host.querySelector('[data-time]')?.textContent).toBe('2000');
    await settle(() => root.render(consumer(recording('replacement', 9000))));
    expect(host.querySelector('[data-time]')?.textContent).toBe('0');
    expect(host.querySelector('input[type="range"]')?.getAttribute('max')).toBe('9000');
  });
});

describe('composable replay effects and diagnostics', () => {
  beforeEach(setUp);
  afterEach(tearDown);

  it('restores external effects when a controlled override is removed without changing an uncontrolled baseline', async () => {
    const bundle = recording('external-effects');
    const baseline: PlaybackEffects = { ...NO_EFFECTS, captions: [{ from: 0, to: 1000, text: 'Host caption' }] };
    const updatedBaseline: PlaybackEffects = { ...NO_EFFECTS, captions: [{ from: 0, to: 2000, text: 'Updated host caption' }] };
    const override: PlaybackEffects = { ...NO_EFFECTS, captions: [{ from: 0, to: 500, text: 'Provider caption' }] };
    const playback = new ReplayController(bundle, { effects: baseline });
    await settle(() => root.render(consumer(bundle, playback)));
    expect(playback.getEffects()).toBe(baseline);
    playback.setEffects(updatedBaseline);
    await settle(() => root.render(consumer(bundle, playback, override)));
    expect(playback.getEffects()).toBe(override);
    await settle(() => root.render(consumer(bundle, playback, NO_EFFECTS)));
    expect(playback.getEffects()).toBe(NO_EFFECTS);
    await settle(() => root.render(consumer(bundle, playback)));
    expect(playback.getEffects()).toBe(updatedBaseline);
  });

  it('releases controlled effects when switching external controllers and unmounting the provider', async () => {
    const bundle = recording('external-replacement');
    const baseline: PlaybackEffects = { ...NO_EFFECTS, captions: [{ from: 0, to: 1000, text: 'First host caption' }] };
    const nextBaseline: PlaybackEffects = { ...NO_EFFECTS, captions: [{ from: 0, to: 1000, text: 'Second host caption' }] };
    const first = new ReplayController(bundle, { effects: baseline });
    const second = new ReplayController(bundle, { effects: nextBaseline });
    await settle(() => root.render(consumer(bundle, first, NO_EFFECTS)));
    expect(first.getEffects()).toBe(NO_EFFECTS);
    await settle(() => root.render(consumer(bundle, second, NO_EFFECTS)));
    expect(first.getEffects()).toBe(baseline);
    expect(second.getEffects()).toBe(NO_EFFECTS);
    await settle(() => root.render(null));
    expect(second.getEffects()).toBe(nextBaseline);
  });

  it('lets a host build its own inspector and seek from diagnostic data while rendering messages as text', async () => {
    const bundle = recording('diagnostics');
    await settle(() =>
      root.render(
        <ReplayProvider bundle={bundle}>
          <Time />
          <ReplayInspector>
            {(model) => (
              <button type="button" onClick={() => model.seek(model.errors[0]?.at ?? 0)}>
                {model.console[0]?.message}
              </button>
            )}
          </ReplayInspector>
        </ReplayProvider>,
      ),
    );
    expect(host.querySelector('script')).toBeNull();
    const button = present(host.querySelector('button'));
    expect(button.textContent).toBe('<script>retained as text</script>');
    await settle(() => button.click());
    expect(host.querySelector('[data-time]')?.textContent).toBe('2400');
  });
});

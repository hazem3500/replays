import type { ReplayBundle } from '../src/shared/replay.ts';
import { request, waterfallFixture } from './waterfall-fixture.ts';

export function performanceFixture() {
  const bundle = waterfallFixture();
  bundle.network = [
    request({ at: 1600, duration: 1000, requestHeaders: [{ name: 'authorization', value: '[REDACTED]' }] }),
    request({ id: 'earlier', at: 400, duration: 200 }),
  ];
  bundle.steps = [
    { at: 1500, kind: 'click', label: 'Open projects' },
    { at: 1900, kind: 'click', label: 'Open details' },
  ];
  bundle.performance = {
    supported: ['paint', 'largest-contentful-paint', 'longtask', 'event'],
    entries: [
      { at: 1000, kind: 'first-contentful-paint', value: 1000 },
      { at: 1700, kind: 'long-task', value: 420 },
      { at: 1750, kind: 'slow-interaction', value: 310, eventType: 'click' },
      { at: 2400, kind: 'largest-contentful-paint', value: 2400 },
      { at: 2800, kind: 'long-task', value: 90 },
    ],
  };
  return bundle;
}

/**
 * The "why" track of a short checkout session: three interactions (the "Plan time" click is slow and sits in a long
 * animation frame with two scripts), four long tasks, three long animation frames and one frame-rate band per second.
 */
export function whyTrack(): NonNullable<ReplayBundle['performance']> {
  const script = (sourceURL: string, sourceFunctionName: string, invoker: string, duration: number, forced = 0) => ({
    sourceURL,
    sourceFunctionName,
    invoker,
    invokerType: 'event-listener',
    duration,
    forcedStyleAndLayoutDuration: forced,
  });
  return {
    supported: ['paint', 'largest-contentful-paint', 'longtask', 'event', 'layout-shift', 'animation-frame', 'long-animation-frame'],
    entries: [
      { at: 300, kind: 'first-contentful-paint', value: 300 },
      { at: 1200, kind: 'largest-contentful-paint', value: 1200 },
      { at: 400, kind: 'long-task', value: 310 },
      { at: 2900, kind: 'long-task', value: 90 },
      { at: 6500, kind: 'long-task', value: 140 },
      { at: 2400, kind: 'slow-interaction', value: 56, eventType: 'click' },
      { at: 5200, kind: 'slow-interaction', value: 120, eventType: 'keydown' },
      { at: 8600, kind: 'slow-interaction', value: 608, eventType: 'click' },
      { at: 8627, kind: 'long-task', value: 182 },
    ],
    frames: Array.from({ length: 12 }, (_, second) => ({ at: second * 1000, elapsed: 1000, frames: second === 8 ? 31 : 60, dropped: second === 8 ? 29 : 0 })),
    longFrames: [
      {
        at: 8500,
        duration: 640,
        blockingDuration: 560,
        renderStart: 600,
        styleAndLayoutStart: 520,
        scripts: [
          script('https://app.example.com/assets/plan-3f9a.js', 'buildSchedule', 'BUTTON#plan.onclick', 412, 38),
          script('https://cdn.example.net/vendor/date-fns.js', 'format', 'Window.requestAnimationFrame', 96),
        ],
      },
      { at: 410, duration: 330, blockingDuration: 270, renderStart: 300, styleAndLayoutStart: 0, scripts: [script('https://app.example.com/assets/boot-71c2.js', '', 'Window.onload', 280)] },
      { at: 10_000, duration: 90, blockingDuration: 40, renderStart: 70, styleAndLayoutStart: 60, scripts: [] },
    ],
    interactions: [
      { at: 2400, interactionId: 1, eventType: 'click', duration: 56, inputDelay: 8, processing: 32, presentation: 16, target: { tag: 'button', name: 'Add to cart' } },
      { at: 5200, interactionId: 2, eventType: 'keydown', duration: 120, inputDelay: 16, processing: 72, presentation: 32, target: { tag: 'input', role: 'textbox', name: 'Search' } },
      {
        at: 8600,
        interactionId: 3,
        eventType: 'click',
        duration: 608,
        inputDelay: 184,
        processing: 352,
        presentation: 72,
        target: { tag: 'button', role: 'button', name: 'Plan time' },
        step: 0,
        frame: 0,
      },
    ],
  };
}

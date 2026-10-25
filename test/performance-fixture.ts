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

// why: dependency-free on purpose. A host puts this inline or as a sync script in <head>, so it must stay a few hundred bytes.
(() => {
  let flag: unknown;
  try {
    flag = JSON.parse(sessionStorage.getItem('replays-record-after-reload') ?? 'null');
  } catch {
    return;
  }
  const exp = typeof flag === 'object' && flag !== null && 'exp' in flag ? flag.exp : 0;
  if (typeof exp !== 'number' || exp < Date.now() || Reflect.get(window, '__replaysEarly')) return;
  const queue: Record<string, { observer: PerformanceObserver; entries: PerformanceEntry[] }> = {};
  Reflect.set(window, '__replaysEarly', queue);
  for (const type of ['paint', 'largest-contentful-paint', 'longtask', 'long-animation-frame', 'layout-shift', 'event']) {
    try {
      const entries: PerformanceEntry[] = [];
      const observer = new PerformanceObserver((list) => entries.push(...list.getEntries()));
      // why: durationThreshold is missing from the DOM typings, so the options are built apart from the literal check.
      const options = { type, buffered: true, durationThreshold: 16 };
      observer.observe(options);
      queue[type] = { observer, entries };
    } catch {
      // why: an unsupported entry type throws; the recorder simply gets no entries of it.
    }
  }
  const boot = document.currentScript?.dataset.boot;
  if (boot) void import(boot).catch(() => {});
})();

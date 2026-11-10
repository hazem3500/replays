// why: dependency-free on purpose. A host puts this inline or as a sync script in <head>, so it must stay a few hundred bytes.
(() => {
  const w = window as unknown as Record<string, unknown>;
  let flag: { exp?: number } | undefined;
  try {
    flag = JSON.parse(sessionStorage.getItem('replays-record-after-reload') ?? 'null');
  } catch {
    return;
  }
  if (!flag || typeof flag.exp !== 'number' || flag.exp < Date.now() || w.__replaysEarly) return;
  const queue: Record<string, { observer: PerformanceObserver; entries: PerformanceEntry[] }> = {};
  w.__replaysEarly = queue;
  for (const type of ['paint', 'largest-contentful-paint', 'longtask', 'long-animation-frame', 'layout-shift', 'event']) {
    try {
      const entries: PerformanceEntry[] = [];
      const observer = new PerformanceObserver((list) => entries.push(...list.getEntries()));
      observer.observe({ type, buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
      queue[type] = { observer, entries };
    } catch {
      // why: an unsupported entry type throws; the recorder simply gets no entries of it.
    }
  }
  const boot = document.currentScript?.dataset.boot;
  if (boot) void import(boot).catch(() => {});
})();

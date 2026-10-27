// Installed before page scripts. Lab INP covers only the scripted interactions in this visit.
export function observe({ player = true, title: observeTitle = true } = {}) {
  const state = {
    lcpMs: null,
    cls: 0,
    interactions: {},
    tasks: [],
    firstFrameMs: null,
    firstReplayTitleMs: null,
    supported: PerformanceObserver.supportedEntryTypes,
  };
  window.__perf = state;
  const observers = [];
  const watch = (type, callback, options = {}) => {
    if (!state.supported.includes(type)) return;
    const observer = new PerformanceObserver((list) => callback(list.getEntries()));
    observer.observe({ type, buffered: true, ...options });
    observers.push([observer, callback]);
  };
  watch('largest-contentful-paint', (entries) => {
    if (entries.length) state.lcpMs = entries.at(-1).startTime;
  });
  let sessionStart = 0,
    lastShift = 0,
    sessionValue = 0;
  watch('layout-shift', (entries) => {
    for (const entry of entries) {
      if (entry.hadRecentInput) continue;
      if (entry.startTime - lastShift > 1000 || entry.startTime - sessionStart > 5000) {
        sessionStart = entry.startTime;
        sessionValue = 0;
      }
      lastShift = entry.startTime;
      sessionValue += entry.value;
      state.cls = Math.max(state.cls, sessionValue);
    }
  });
  watch(
    'event',
    (entries) => {
      for (const entry of entries)
        if (entry.interactionId) {
          state.interactions[entry.interactionId] = Math.max(state.interactions[entry.interactionId] ?? 0, entry.duration);
        }
    },
    { durationThreshold: 16 },
  );
  watch('longtask', (entries) => {
    state.tasks.push(...entries.map((entry) => ({ start: entry.startTime, duration: entry.duration })));
  });
  window.__flushPerf = () => {
    for (const [observer, callback] of observers) callback(observer.takeRecords());
  };
  // A frame is ready only once the rrweb iframe contains the recorded body and has crossed two paints.
  const check = () => {
    if (state.firstFrameMs !== null) return;
    const frames = [...document.querySelectorAll('.replayer-wrapper iframe')];
    if (frames.length && frames.every((frame) => frame.contentDocument?.body?.childElementCount > 0)) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          state.firstFrameMs = performance.now();
        }),
      );
    } else requestAnimationFrame(check);
  };
  if (player) requestAnimationFrame(check);
  const title = () => {
    const element = document.querySelector('.feed-title');
    if (element?.textContent.trim()) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          state.firstReplayTitleMs = performance.now();
        }),
      );
    } else requestAnimationFrame(title);
  };
  if (observeTitle) requestAnimationFrame(title);
}

import { record } from 'rrweb';

import { MASK_INPUT_OPTIONS } from './mask-inputs.ts';

declare global {
  interface Window {
    __REPLAYS_FLUSH__?: (final?: boolean) => RecorderChunk;
    __REPLAYS_RUNNING__?: boolean;
    __REPLAYS_ERROR__?: string;
    __replaysNavigationFlush?: (payload: string) => void;
    /** The host's mask selectors (redaction `maskSelectors`), set by the capture session before this script runs. */
    __REPLAYS_MASK_TEXT__?: string;
  }
}

interface RecorderChunk {
  events: Array<Record<string, unknown> & { timestamp: number }>;
  console: Array<{ at: number; level: string; message: string; url: string }>;
  performance: Array<{ at: number; kind: string; value: number; eventType?: string }>;
  performanceSupported: string[];
}

try {
  if (window.top === window && !window.__REPLAYS_RUNNING__) {
    window.__REPLAYS_RUNNING__ = true;
    let events: RecorderChunk['events'] = [];
    let consoleEntries: RecorderChunk['console'] = [];
    let performanceEntries: RecorderChunk['performance'] = [];
    const supportedTypes = new Set<string>();
    const performanceObservers: PerformanceObserver[] = [];
    const maxPerformanceEntries = 300;
    const supported = new Set(typeof PerformanceObserver === 'undefined' ? [] : (PerformanceObserver.supportedEntryTypes ?? []));
    let finalMetricsSent = false;
    // LCP entries are not buffered on the performance timeline, so only an observer can see them.
    let latestLcp: { startTime: number } | undefined;

    const interactionTypes = new Set(['click', 'keydown', 'keyup', 'input', 'beforeinput', 'pointerdown', 'pointerup', 'compositionend']);

    const recordPerformance = (entry: { startTime: number; duration?: number; name?: string; entryType?: string }) => {
      if (performanceEntries.length >= maxPerformanceEntries || !Number.isFinite(entry.startTime)) return;
      if (entry.entryType === 'longtask' && (entry.duration ?? 0) >= 50) {
        performanceEntries.push({ at: performance.timeOrigin + entry.startTime, kind: 'long-task', value: entry.duration ?? 0 });
      } else if (entry.entryType === 'event' && entry.name && interactionTypes.has(entry.name) && (entry.duration ?? 0) >= 40) {
        performanceEntries.push({
          at: performance.timeOrigin + entry.startTime,
          kind: 'slow-interaction',
          value: entry.duration ?? 0,
          eventType: entry.name,
        });
      }
    };

    for (const type of ['longtask', 'event'] as const) {
      if (!supported.has(type)) continue;
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) recordPerformance(entry);
        });
        observer.observe(
          (type === 'event'
            ? { type, buffered: true, durationThreshold: 40 }
            : { type, buffered: true }) as unknown as PerformanceObserverInit,
        );
        performanceObservers.push(observer);
        supportedTypes.add(type);
      } catch {
        // The entry type exists in the browser but this context cannot observe it.
      }
    }
    if (supported.has('paint')) supportedTypes.add('paint');
    if (supported.has('largest-contentful-paint')) {
      try {
        const observer = new PerformanceObserver((list) => {
          const last = list.getEntries().at(-1);
          if (last && Number.isFinite(last.startTime)) latestLcp = last;
        });
        observer.observe({ type: 'largest-contentful-paint', buffered: true });
        performanceObservers.push(observer);
        supportedTypes.add('largest-contentful-paint');
      } catch {
        // The entry type exists in the browser but this context cannot observe it.
      }
    }

    const finalPaintMetrics = () => {
      if (finalMetricsSent) return;
      finalMetricsSent = true;
      for (const observer of performanceObservers) {
        for (const entry of observer.takeRecords()) {
          if (entry.entryType === 'largest-contentful-paint' && Number.isFinite(entry.startTime)) latestLcp = entry;
          else recordPerformance(entry);
        }
      }
      const paint = performance.getEntriesByType('paint').find((entry) => entry.name === 'first-contentful-paint');
      if (paint)
        performanceEntries.push({ at: performance.timeOrigin + paint.startTime, kind: 'first-contentful-paint', value: paint.startTime });
      if (latestLcp)
        performanceEntries.push({
          at: performance.timeOrigin + latestLcp.startTime,
          kind: 'largest-contentful-paint',
          value: latestLcp.startTime,
        });
    };

    const safe = (value: unknown) => {
      const seen = new WeakSet<object>();
      try {
        return typeof value === 'string'
          ? value
          : JSON.stringify(value, (_key, nested) => {
              if (typeof nested === 'object' && nested !== null) {
                if (seen.has(nested)) return '[Circular]';
                seen.add(nested);
              }
              if (nested instanceof Error) return { name: nested.name, message: nested.message, stack: nested.stack };
              return nested;
            });
      } catch {
        return String(value);
      }
    };

    const maskTextSelector = typeof window.__REPLAYS_MASK_TEXT__ === 'string' ? window.__REPLAYS_MASK_TEXT__ : undefined;
    delete window.__REPLAYS_MASK_TEXT__;
    // An invalid selector stops the recorder (the capture fails) rather than recording the text it should hide.
    if (maskTextSelector) document.createDocumentFragment().querySelector(maskTextSelector);

    record({
      emit(event) {
        events.push(event as unknown as RecorderChunk['events'][number]);
      },
      // rrweb's maskAllInputs set plus hidden inputs (CSRF tokens); see sanitize.ts.
      maskInputOptions: MASK_INPUT_OPTIONS,
      ...(maskTextSelector ? { maskTextSelector } : {}),
    });

    for (const level of ['debug', 'info', 'log', 'warn', 'error'] as const) {
      const original = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        consoleEntries.push({
          at: Date.now(),
          level,
          message: args.map(safe).join(' '),
          url: location.href,
        });
        original(...args);
      };
    }

    addEventListener('error', (event) => {
      consoleEntries.push({
        at: Date.now(),
        level: 'error',
        message: event.error instanceof Error ? (event.error.stack ?? event.error.message) : event.message || 'Uncaught error',
        url: location.href,
      });
    });
    addEventListener('unhandledrejection', (event) => {
      consoleEntries.push({
        at: Date.now(),
        level: 'error',
        message: `Unhandled rejection: ${safe(event.reason)}`,
        url: location.href,
      });
    });

    window.__REPLAYS_FLUSH__ = (final = false) => {
      if (final) finalPaintMetrics();
      const chunk = {
        events,
        console: consoleEntries,
        performance: performanceEntries,
        performanceSupported: [...supportedTypes],
      };
      events = [];
      consoleEntries = [];
      performanceEntries = [];
      return chunk;
    };

    addEventListener(
      'pagehide',
      () => {
        const chunk = window.__REPLAYS_FLUSH__?.(true);
        if (chunk && (chunk.events.length || chunk.console.length || chunk.performance.length)) {
          window.__replaysNavigationFlush?.(JSON.stringify(chunk));
        }
      },
      { capture: true },
    );
  }
} catch (error) {
  window.__REPLAYS_ERROR__ = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

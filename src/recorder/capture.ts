import type { BodyCapture, PendingBody } from './body-capture.ts';
import type { ReplayConsoleLevel, ReplayNetworkBody } from './bundle-types.ts';
import { traceIdFromHeaders } from './trace.ts';
import { filterHeaders, redactText, redactUrl } from './redact.ts';

/**
 * A console entry before it is placed on the replay timeline (`at` is epoch
 * ms).
 */
export type RawConsoleEntry = {
  at: number;
  level: ReplayConsoleLevel;
  message: string;
  url: string;
};

/**
 * A network entry before it is placed on the replay timeline (`at` is epoch
 * ms).
 */
export type RawNetworkEntry = {
  at: number;
  duration: number;
  method: string;
  url: string;
  status: number;
  statusText: string;
  mimeType?: string;
  requestHeaders: { name: string; value: string }[];
  responseHeaders: { name: string; value: string }[];
  /** Backend trace ID from the retained trace headers, when there is one. */
  traceId?: string;
  requestBody?: ReplayNetworkBody;
  responseBody?: ReplayNetworkBody;
};

export type ConsoleCaptureOptions = {
  debugging?: boolean;
  levels: readonly ReplayConsoleLevel[];
  maxEntries: number;
  onEntry: (entry: RawConsoleEntry) => void;
};

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  const seen = new WeakSet<object>();
  try {
    // why: `undefined`, functions and symbols stringify to `undefined`.
    const json = JSON.stringify(value, (_key, nested: unknown) => {
      if (typeof nested === 'object' && nested !== null) {
        if (seen.has(nested)) return '[Circular]';
        seen.add(nested);
      }
      return nested;
    }) as string | undefined;
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

function currentUrl() {
  return redactUrl(location.href);
}

/**
 * Wraps the selected console levels plus `error` / `unhandledrejection` events.
 * Messages go through `redactText`; stacks are not kept. Returns a function
 * that restores the console.
 */
export function captureConsole(options: ConsoleCaptureOptions): () => void {
  let active = true;
  let count = 0;
  const push = (level: ReplayConsoleLevel, message: string) => {
    if (!active || count >= options.maxEntries) return;
    count += 1;
    options.onEntry({
      at: Date.now(),
      level,
      message: redactText(message),
      url: currentUrl(),
    });
  };

  const originals = new Map<ReplayConsoleLevel, (...args: unknown[]) => void>();
  const wrappers = new Map<ReplayConsoleLevel, (...args: unknown[]) => void>();
  for (const level of options.levels) {
    const original = console[level];
    originals.set(level, original);
    const wrapper = (...args: unknown[]) => {
      push(
        level,
        args
          .slice(0, 20)
          .map((value) => (options.debugging && value instanceof Error ? (value.stack ?? value.message).slice(0, 4000) : stringify(value)))
          .join(' ')
          .slice(0, 8000),
      );
      original.apply(console, args);
    };
    wrappers.set(level, wrapper);
    console[level] = wrapper;
  }

  const onError = (event: ErrorEvent) => {
    push(
      'error',
      options.debugging && event.error instanceof Error
        ? (event.error.stack ?? event.error.message).slice(0, 4000)
        : stringify(event.error ?? event.message ?? 'Uncaught error'),
    );
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    push(
      'error',
      `Unhandled rejection: ${options.debugging && reason instanceof Error ? (reason.stack ?? reason.message).slice(0, 4000) : stringify(reason)}`,
    );
  };
  addEventListener('error', onError);
  addEventListener('unhandledrejection', onRejection);

  return () => {
    active = false;
    for (const [level, original] of originals) {
      // why: leave a later wrapper (another tool) in place; ours is inert now.
      if (console[level] === wrappers.get(level)) console[level] = original;
    }
    removeEventListener('error', onError);
    removeEventListener('unhandledrejection', onRejection);
  };
}

export type NetworkCaptureOptions = {
  allowedHeaders: readonly string[];
  maxEntries: number;
  /** Requests whose URL matches are not recorded (e.g. the upload endpoint). */
  ignore: (url: string) => boolean;
  onEntry: (entry: RawNetworkEntry) => void;
  /** Present with `capture.network: 'bodies'`; disposed when the capture stops. */
  bodies?: BodyCapture;
};

const UNAVAILABLE: ReplayNetworkBody = Object.freeze({ omitted: 'unavailable' });

/** A body read in the background lands later; until then it is unavailable. */
function settle(body: PendingBody, apply: (body: ReplayNetworkBody) => void) {
  if (!body) return;
  if (!(body instanceof Promise)) {
    apply(body);
    return;
  }
  apply(UNAVAILABLE);
  void body.then(apply);
}

function absoluteUrl(value: string) {
  try {
    return new URL(value, location.href).toString();
  } catch {
    return value;
  }
}

function mimeTypeOf(headers: { name: string; value: string }[]) {
  return headers
    .find((header) => header.name === 'content-type')
    ?.value.split(';')[0]
    ?.trim();
}

function parseRawHeaders(raw: string): [string, string][] {
  return raw
    .trim()
    .split(/[\r\n]+/)
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf(':');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    });
}

type XhrInfo = {
  method: string;
  url: string;
  headers: [string, string][];
  start: number;
  startPerf: number;
};

/**
 * Wraps `fetch` and `XMLHttpRequest` while recording. Method, URL (redacted),
 * status, timing and allow-listed headers are kept; bodies are read only
 * through `bodies`. Returns a function that restores both.
 */
export function captureNetwork(options: NetworkCaptureOptions): () => void {
  let active = true;
  let count = 0;
  const push = (entry: RawNetworkEntry) => {
    if (!active || count >= options.maxEntries) return;
    count += 1;
    options.onEntry(entry);
    return entry;
  };
  const bodies = () => (active && count < options.maxEntries ? options.bodies : undefined);
  const finish = (
    base: { method: string; url: string; start: number; startPerf: number },
    requestHeaders: Iterable<[string, string]>,
    result: {
      status: number;
      statusText: string;
      headers: Iterable<[string, string]>;
    },
  ) => {
    const responseHeaders = filterHeaders(result.headers, options.allowedHeaders);
    const mimeType = mimeTypeOf(responseHeaders);
    const sentHeaders = filterHeaders(requestHeaders, options.allowedHeaders);
    const traceId = traceIdFromHeaders(sentHeaders, responseHeaders);
    return push({
      at: base.start,
      duration: Math.max(0, Math.round(performance.now() - base.startPerf)),
      method: base.method.toUpperCase(),
      url: redactUrl(base.url),
      status: result.status,
      statusText: redactText(result.statusText, 200),
      ...(mimeType ? { mimeType } : {}),
      requestHeaders: sentHeaders,
      responseHeaders,
      ...(traceId ? { traceId } : {}),
    });
  };

  const restorers: (() => void)[] = [];

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === 'function') {
    const wrappedFetch: typeof fetch = async (input, init) => {
      const request = input instanceof Request ? input : undefined;
      const url = absoluteUrl(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (!active || options.ignore(url)) return originalFetch(input, init);
      const base = {
        method: init?.method ?? request?.method ?? 'GET',
        url,
        start: Date.now(),
        startPerf: performance.now(),
      };
      const headers = new Headers(init?.headers ?? request?.headers);
      const requestHeaders = [...headers.entries()];
      const reader = bodies();
      const requestBody = reader?.fetchRequest(input, init, headers);
      try {
        const response = await originalFetch(input, init);
        const entry = finish(base, requestHeaders, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers.entries(),
        });
        if (entry) {
          settle(requestBody, (body) => {
            entry.requestBody = body;
          });
          settle(reader?.fetchResponse(response), (body) => {
            entry.responseBody = body;
          });
        }
        return response;
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === 'AbortError';
        const entry = finish(base, requestHeaders, {
          status: 0,
          // why: A status of 0 with text marks a failed request in the viewer.
          statusText: aborted ? 'net::ERR_ABORTED' : 'net::ERR_FAILED',
          headers: [],
        });
        if (entry) {
          settle(requestBody, (body) => {
            entry.requestBody = body;
          });
          settle(reader && UNAVAILABLE, (body) => {
            entry.responseBody = body;
          });
        }
        throw error;
      }
    };
    globalThis.fetch = wrappedFetch;
    restorers.push(() => {
      if (globalThis.fetch === wrappedFetch) globalThis.fetch = originalFetch;
    });
  }

  const Xhr = globalThis.XMLHttpRequest;
  if (typeof Xhr === 'function') {
    const proto = Xhr.prototype;
    const { open, send, setRequestHeader } = proto;
    const info = new WeakMap<XMLHttpRequest, XhrInfo>();
    const patchedOpen = function patchedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      info.set(this, {
        method,
        url: absoluteUrl(String(url)),
        headers: [],
        start: 0,
        startPerf: 0,
      });
      (open as (...args: unknown[]) => void).call(this, method, url, ...rest);
    };
    const patchedSetRequestHeader = function patchedSetRequestHeader(this: XMLHttpRequest, name: string, value: string) {
      info.get(this)?.headers.push([name, value]);
      setRequestHeader.call(this, name, value);
    };
    const patchedSend = function patchedSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const entry = info.get(this);
      if (entry && active && !options.ignore(entry.url)) {
        entry.start = Date.now();
        entry.startPerf = performance.now();
        const contentType = entry.headers.filter(([name]) => name.toLowerCase() === 'content-type').at(-1)?.[1];
        const reader = bodies();
        const requestBody = reader?.xhrRequest(body, contentType);
        this.addEventListener(
          'loadend',
          () => {
            const kept = finish(entry, entry.headers, {
              status: this.status,
              statusText: this.status === 0 ? 'net::ERR_FAILED' : this.statusText,
              headers: parseRawHeaders(this.getAllResponseHeaders()),
            });
            if (kept) {
              settle(requestBody, (sent) => {
                kept.requestBody = sent;
              });
              settle(reader?.xhrResponse(this), (received) => {
                kept.responseBody = received;
              });
            }
          },
          { once: true },
        );
      }
      send.call(this, body);
    };
    proto.open = patchedOpen;
    proto.setRequestHeader = patchedSetRequestHeader;
    proto.send = patchedSend;
    /* why: like fetch: a patch installed after ours (a lazily started RUM or
       Sentry integration) is left in place. */
    restorers.push(() => {
      if (proto.open === patchedOpen) proto.open = open;
      if (proto.send === patchedSend) proto.send = send;
      if (proto.setRequestHeader === patchedSetRequestHeader) proto.setRequestHeader = setRequestHeader;
    });
  }

  return () => {
    active = false;
    for (const restore of restorers) restore();
    options.bodies?.dispose();
  };
}

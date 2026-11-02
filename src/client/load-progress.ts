import { useSyncExternalStore } from 'react';

/**
 * How far the replay bundle has downloaded, for the skeleton's progress hint. One request at a time (the page
 * being opened); `total` is known when the server names the decoded size (Content-Length, or X-Decoded-Length).
 */
export interface LoadProgress {
  loaded: number;
  total?: number;
}

let progress: LoadProgress | undefined;
const listeners = new Set<() => void>();

function publish(next: LoadProgress | undefined) {
  progress = next;
  for (const listener of listeners) listener();
}

export function useLoadProgress() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => progress,
    () => undefined,
  );
}

/**
 * Reads a response body as text while publishing progress for the skeleton's hint. Falls back to `text()` where
 * streams are missing. The reader counts decoded bytes, so the total is Content-Length only for a body that is not
 * content-encoded; a compressed one names its decoded size in X-Decoded-Length (src/server/serve-object.ts).
 */
export async function readTextWithProgress(response: Response): Promise<string> {
  const total = decodedTotal(response.headers);
  if (!response.body || typeof TextDecoder === 'undefined') return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let loaded = 0;
  publish({ loaded, ...(total ? { total } : {}) });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      chunks.push(decoder.decode(value, { stream: true }));
      publish({ loaded, ...(total ? { total } : {}) });
    }
    chunks.push(decoder.decode());
  } finally {
    publish(undefined);
  }
  return chunks.join('');
}

/** The body's decoded size, when the response says it (else the bar is indeterminate). */
export function decodedTotal(headers: Headers): number | undefined {
  const encoded = Boolean(headers.get('content-encoding'));
  const length = Number(headers.get(encoded ? 'x-decoded-length' : 'content-length'));
  return Number.isFinite(length) && length > 0 ? length : undefined;
}

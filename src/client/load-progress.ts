import { useSyncExternalStore } from 'react';

/**
 * How far the replay bundle has downloaded, for the skeleton's progress hint. One request at a time (the page
 * being opened); `total` is known only when the server sent an uncompressed Content-Length.
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
 * streams are missing. The byte total counts only when the body is not content-encoded (otherwise Content-Length
 * is the compressed size and the bar would overshoot).
 */
export async function readTextWithProgress(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  const encoded = Boolean(response.headers.get('content-encoding'));
  const total = Number.isFinite(length) && length > 0 && !encoded ? length : undefined;
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

import { fetchPage } from './sign-in.tsx';
import { queryOptions } from '@tanstack/react-query';

import { EMPTY_EDITS, editListOf, type ReplayEdits, type StoredReplayEdits } from '../shared/edits.ts';
import { betaEditor } from './config.ts';
import { LoadError } from './queries.ts';
import { apiUrl } from './route.ts';

/** A replay's edit list as loaded: the stored list and the ETag a save must send back (`If-Match`). */
export interface LoadedEdits {
  stored: StoredReplayEdits;
  etag: string;
}

const NONE: LoadedEdits = { stored: { ...EMPTY_EDITS, revision: 0 }, etag: '"e.none"' };

const editsUrl = (id: string) => apiUrl(`replays/${encodeURIComponent(id)}/edits`);

/** `GET /api/replays/<id>/edits`; a server without edits (404 on an older deploy) reads as none. */
export async function fetchEdits(id: string, signal?: AbortSignal): Promise<LoadedEdits> {
  // Beta editor off: no request at all, the replay is shown as recorded.
  if (!betaEditor()) return NONE;
  const response = await fetchPage(editsUrl(id), signal ? { signal } : {});
  if (response.status === 404) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    if (body?.error === 'replay not found') throw new LoadError('Replay not found', 404);
    return NONE;
  }
  if (!response.ok) throw new LoadError(`Edits failed to load (${response.status})`, response.status);
  return { stored: (await response.json()) as StoredReplayEdits, etag: response.headers.get('etag') ?? NONE.etag };
}

/**
 * The edit list, revalidated on each open (the server answers 304 while unchanged). Not refetched when the window is revisited: new
 * edits would remount the player under the person watching; the next open shows them.
 */
export const editsQuery = (id: string) =>
  queryOptions({
    queryKey: ['edits', id] as const,
    queryFn: ({ signal }) => fetchEdits(id, signal),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

/** A save that lost to someone else's: their list, to reload from. */
export class EditsConflictError extends Error {
  readonly current: LoadedEdits;
  constructor(current: LoadedEdits) {
    super('These edits changed since you opened them.');
    this.name = 'EditsConflictError';
    this.current = current;
  }
}

/** The server has no edits API (an older deploy): saving cannot work there, retrying will not help. */
export class EditsUnavailableError extends Error {
  constructor() {
    super('Editing isn’t available on this server');
    this.name = 'EditsUnavailableError';
  }
}

/** `PUT /api/replays/<id>/edits` over the version in `etag`; resolves to the stored list and its new ETag. */
export async function saveEdits(id: string, edits: ReplayEdits, etag: string): Promise<LoadedEdits> {
  const response = await fetch(editsUrl(id), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': etag },
    body: JSON.stringify(editListOf(edits)),
  });
  if (response.status === 409) {
    const body = (await response.json().catch(() => undefined)) as { current?: StoredReplayEdits } | undefined;
    throw new EditsConflictError({ stored: body?.current ?? NONE.stored, etag: response.headers.get('etag') ?? NONE.etag });
  }
  if (response.status === 404 || response.status === 405) {
    const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    if (body?.error !== 'replay not found') throw new EditsUnavailableError();
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).trim();
    throw new Error(detail && detail.length < 200 && !detail.startsWith('{') ? detail : `Saving failed (${response.status})`);
  }
  return { stored: (await response.json()) as StoredReplayEdits, etag: response.headers.get('etag') ?? NONE.etag };
}

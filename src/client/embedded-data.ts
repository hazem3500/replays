import { type DehydratedState, hydrate, type QueryClient } from '@tanstack/react-query';

/** The element the server embeds a page's first-paint data in. */
export const EMBEDDED_ID = 'replays-embedded';

const isDehydratedState = (value: unknown): value is DehydratedState =>
  typeof value === 'object' &&
  value !== null &&
  'queries' in value &&
  Array.isArray(value.queries) &&
  'mutations' in value &&
  Array.isArray(value.mutations);

/**
 * Hydrates the data the server put in the page for its first paint into `client`, before the first render, so the
 * page (or a route loader's `ensureQueryData`) finds it instead of fetching: a TanStack `DehydratedState` in
 * `<script type="application/json" id="replays-embedded">`, keyed like the app's queries (['replay', id],
 * ['suite', id], ['index', 'replays', search], ['index', 'suites', request]). Absent or malformed: a no-op.
 */
export function hydrateEmbedded(client: QueryClient) {
  if (typeof document === 'undefined') return;
  const element = document.getElementById(EMBEDDED_ID);
  if (!element?.textContent) return;
  let state: unknown;
  try {
    state = JSON.parse(element.textContent);
  } catch {
    state = undefined;
  }
  if (isDehydratedState(state)) hydrate(client, state);
  // why: read once, so a later hydrate can never resurrect the first page's data over fresher queries.
  element.remove();
}

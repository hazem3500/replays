/**
 * Done in edit mode hands the viewer a moment to resume from: the editor's playhead mapped onto the edited timeline.
 * The viewer that opens next for that replay (within a few seconds) starts there and plays the result at once.
 * Module state, not the URL: a reload or a shared link opens the viewer as usual.
 */
interface Handoff {
  id: string;
  /** Edited ms. */
  time: number;
  at: number;
}

const FRESH_MS = 10_000;
let pending: Handoff | undefined;

export function handOff(id: string, time: number) {
  pending = { id, time: Math.max(0, Math.round(time)), at: Date.now() };
}

/** The hand-off for `id`, if one is fresh (read during render: it is cleared by `clearHandoff`, not here). */
export function peekHandoff(id: string) {
  if (!pending || pending.id !== id || Date.now() - pending.at > FRESH_MS) return undefined;
  return pending;
}

export function clearHandoff(id: string) {
  if (pending?.id === id) pending = undefined;
}

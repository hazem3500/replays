import { personMatch, type ReplayPerson } from '../../shared/people.ts';
import { MAX_LABEL } from '../../shared/edit-list.ts';

/** Where an inline rename was started: the steps list or the caption on the player. */
export type RenameSurface = 'rail' | 'caption';

export interface RenameSession {
  /** The step's stored-name key (`stepNameKeys`). */
  key: string;
  surface: RenameSurface;
  draft: string;
  /** The label when editing began; a save that leaves it alone writes nothing. */
  label: string;
  /** Whether playback was running, so a finished caption edit can resume it. */
  wasPlaying: boolean;
}

export type RenameAction =
  | { type: 'start'; key: string; surface: RenameSurface; label: string; wasPlaying?: boolean }
  | { type: 'change'; draft: string }
  | { type: 'end' };

export function renameReducer(state: RenameSession | undefined, action: RenameAction): RenameSession | undefined {
  switch (action.type) {
    case 'start':
      if (state?.key === action.key && state.surface === action.surface) return state;
      return { key: action.key, surface: action.surface, draft: action.label, label: action.label, wasPlaying: action.wasPlaying ?? false };
    case 'change':
      return state && { ...state, draft: action.draft.slice(0, MAX_LABEL) };
    case 'end':
      return undefined;
  }
}

/** The name a finished session writes: undefined when nothing changed, '' to go back to the automatic label. */
export function renameResult(session: RenameSession, reset = false): string | undefined {
  if (reset) return '';
  const name = session.draft.trim().slice(0, MAX_LABEL);
  return name === session.label.trim() ? undefined : name;
}

export interface RenameViewer {
  email?: string;
  roles?: readonly string[];
}

/**
 * Whether the signed-in person may rename steps on a replay: an email on one of its people (any role), or the admin role.
 * Mirrors the server's check (src/server/edit-permission.ts), which is the one that decides.
 */
export function mayRename(viewer: RenameViewer | undefined, people: readonly ReplayPerson[] | undefined) {
  if (!viewer) return false;
  if (viewer.roles?.includes('admin')) return true;
  return Boolean(viewer.email && personMatch(people, { email: viewer.email }) !== undefined);
}

/** The session as an external store, so typing re-renders the input and not the viewer around it. */
export function createRenameStore() {
  let state: RenameSession | undefined;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispatch: (action: RenameAction) => {
      const next = renameReducer(state, action);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
  };
}

export type RenameStore = ReturnType<typeof createRenameStore>;

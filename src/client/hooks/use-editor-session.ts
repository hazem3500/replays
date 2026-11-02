import { useQueryClient } from '@tanstack/react-query';
import { type Dispatch, useCallback, useEffect, useRef, useState } from 'react';

import { editListOf, type EditTimeline, type StoredReplayEdits } from '../../shared/edits.ts';
import { EditsConflictError, EditsUnavailableError, editsQuery, type LoadedEdits, saveEdits } from '../edits.ts';
import { handOff } from '../editor/handoff.ts';
import { type EditorAction, type EditorState, isDirty, leavesSomething } from '../editor/state.ts';
import { editorStrings } from '../editor/strings.ts';
import { navigate as legacyNavigate } from '../navigation.ts';
import type { ReplayController } from '../player.ts';
import { useNavigate } from '../routing/use-navigate.ts';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed' | 'unavailable';

/** Quiet time after the last change before it is saved. */
const AUTOSAVE_MS = 700;
/** Retries after a failed save: 2 s, 4 s, 8 s… up to RETRY_MAX_MS. */
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30_000;

interface SessionOptions {
  id: string;
  player: ReplayController;
  loaded: LoadedEdits;
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  timeline: EditTimeline;
  say: (message: string) => void;
}

/**
 * Edit mode's session with the server: autosave (with backoff after failures), the conflict with someone else's
 * newer edits, and leaving — which waits for the save and hands the playhead to the viewer.
 */
export function useEditorSession({ id, player, loaded, state, dispatch, timeline, say }: SessionOptions) {
  const queryClient = useQueryClient();
  const duration = player.duration;
  const dirty = isDirty(state);
  const [etag, setEtag] = useState(loaded.etag);
  const [stored, setStored] = useState(loaded.stored);
  const [status, setStatus] = useState<SaveStatus>('idle');
  /** Failed saves in a row (the retry backoff), and the last failure's reason (the indicator's tooltip). */
  const [failures, setFailures] = useState(0);
  const [failure, setFailure] = useState('');
  const [conflict, setConflict] = useState<LoadedEdits>();

  // Latest values for listeners that live as long as the page; `save` also writes the etag and conflict here
  // so a save that follows at once never sends a stale version.
  const live = useRef({ state, dirty, timeline, etag, conflict });
  useEffect(() => {
    live.current = { state, dirty, timeline, etag, conflict };
  }, [state, dirty, timeline, etag, conflict]);

  const saving = useRef<Promise<boolean> | undefined>(undefined);
  const save = useCallback(async (): Promise<boolean> => {
    if (saving.current) await saving.current;
    const { state: current, dirty: changed, etag: version, conflict: blocked } = live.current;
    if (!changed) return true;
    if (blocked) return false;
    if (!leavesSomething(current.present, duration)) return false;
    const run = (async () => {
      setStatus('saving');
      try {
        const result = await saveEdits(id, current.present, version);
        live.current.etag = result.etag;
        setEtag(result.etag);
        setStored(result.stored);
        dispatch({ type: 'saved', edits: editListOf(result.stored) });
        queryClient.setQueryData(editsQuery(id).queryKey, result);
        setStatus('saved');
        setFailures(0);
        return true;
      } catch (error) {
        if (error instanceof EditsConflictError) {
          live.current.conflict = error.current;
          setConflict(error.current);
          setStatus('idle');
        } else {
          // A detail, not a headline: the indicator says "Not saved · Retry" and retries on its own.
          setStatus(error instanceof EditsUnavailableError ? 'unavailable' : 'failed');
          setFailure(error instanceof Error ? error.message : String(error));
          setFailures((count) => count + 1);
        }
        return false;
      }
    })();
    saving.current = run;
    try {
      return await run;
    } finally {
      saving.current = undefined;
    }
  }, [dispatch, duration, id, queryClient]);

  // One drag is one change, so this saves when the drag settles. A server without the edits API is not retried.
  useEffect(() => {
    if (!dirty || conflict || status === 'unavailable' || status === 'saving') return;
    const wait = status === 'failed' ? Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1)) : AUTOSAVE_MS;
    const timer = window.setTimeout(() => void save(), wait);
    return () => window.clearTimeout(timer);
    // Every change restarts the quiet period, hence `state.present` among the dependencies.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [conflict, dirty, state.present, failures, save, status]);

  /** The viewer resumes where the playhead is, on the edited timeline (the start when it is at the end). */
  const handOffPlayhead = useCallback(() => {
    const current = live.current.timeline;
    const time = player.getTime();
    handOff(id, time >= player.duration - 1 || current.toEdited(time) >= current.duration - 1 ? 0 : current.toEdited(time));
  }, [id, player]);

  // Leaving without Done (browser Back, a key on another route): the pending change still saves.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(
    () => () => {
      handOffPlayhead();
      if (live.current.dirty) void saveRef.current();
    },
    [handOffPlayhead],
  );

  /** Leaves edit mode once the latest change is saved (it stays, with a note, if saving fails). */
  const exit = useCallback(
    async (go: () => void) => {
      if (live.current.dirty && !(await save()) && live.current.dirty) {
        say(editorStrings.notes.notSaved);
        return;
      }
      handOffPlayhead();
      go();
    },
    [handOffPlayhead, save, say],
  );
  const navigate = useNavigate();
  /** Back to the replay (or its original recording), once saved. */
  const leave = useCallback(
    (search: { original?: true } = {}) => exit(() => navigate({ to: '/r/$id', params: { id }, search })),
    [exit, id, navigate],
  );

  // Kept beside `exit`/`leave` on purpose: this capture becomes the router's `useBlocker`. A link out of edit mode
  // (the back arrow) waits for the save; closing the tab with unsaved changes asks first.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!live.current.dirty || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.target || link.origin !== location.origin) return;
      event.preventDefault();
      event.stopPropagation();
      void exit(() => legacyNavigate(link.href));
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (live.current.dirty) event.preventDefault();
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [exit]);

  const loadTheirs = useCallback(() => {
    if (!conflict) return;
    dispatch({ type: 'load', edits: editListOf(conflict.stored) });
    setEtag(conflict.etag);
    setStored(conflict.stored);
    setConflict(undefined);
  }, [conflict, dispatch]);
  const keepMine = useCallback(() => {
    if (!conflict) return;
    setEtag(conflict.etag);
    live.current.etag = conflict.etag;
    live.current.conflict = undefined;
    setConflict(undefined);
  }, [conflict]);

  return { dirty, stored: stored as StoredReplayEdits, status, failure, conflict, save, exit, leave, loadTheirs, keepMine };
}

export type EditorSession = ReturnType<typeof useEditorSession>;

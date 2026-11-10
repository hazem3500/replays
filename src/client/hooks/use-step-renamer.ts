import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import * as z from 'zod/mini';

import { editListOf, type ReplayEdits, type StoredReplayEdits, stepNameKeys, withStepName } from '../../shared/edits.ts';
import type { ReplayPerson } from '../../shared/people.ts';
import type { ReplayStep } from '../../shared/replay.ts';
import { apiUrl } from '../api/fetch.ts';
import { editingEnabled } from '../config.ts';
import { EditsConflictError, editsQuery, type LoadedEdits, saveEdits } from '../edits.ts';
import { fetchPage } from '../sign-in.tsx';
import { notify } from '../toast.ts';
import { createRenameStore, mayRename, renameResult, type RenameViewer } from '../viewer/step-rename.ts';
import type { StepRenaming } from '../viewer/step-rename-context.ts';

const viewerSchema = z.object({ email: z.optional(z.string()), roles: z.optional(z.array(z.string())) });

const NO_NAMES: Readonly<Record<string, string>> = {};

/** `GET /api/me`: who is signed in; only asked where editing is on. */
function useViewerIdentity(enabled: boolean) {
  return useQuery({
    queryKey: ['me', 'rename'] as const,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async ({ signal }): Promise<RenameViewer> => {
      const response = await fetchPage(apiUrl('me'), { signal });
      if (!response.ok) throw new Error(`me ${response.status}`);
      const viewer = viewerSchema.parse(await response.json());
      return { ...(viewer.email ? { email: viewer.email } : {}), ...(viewer.roles ? { roles: viewer.roles } : {}) };
    },
  }).data;
}

/**
 * Renaming steps through the edits sidecar (`stepNames`): optimistic in the query cache, one save at a time, one retry over
 * the current list when another save won (409), and a revert with a note when the save fails.
 */
export function useStepRenamer({
  replayId,
  steps,
  stepIndices,
  people,
  edits,
  original,
}: {
  replayId: string;
  /** The recording's steps, as stored (names are keyed by their original times). */
  steps: readonly ReplayStep[];
  /** Original index of each shown step. */
  stepIndices: readonly number[];
  people: readonly ReplayPerson[] | undefined;
  edits: LoadedEdits | undefined;
  original: boolean;
}): StepRenaming {
  const queryClient = useQueryClient();
  const enabled = editingEnabled() && !original && edits !== undefined;
  const viewer = useViewerIdentity(enabled);
  const [store] = useState(createRenameStore);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const queryKey = editsQuery(replayId).queryKey;
  const sourceKeys = stepNameKeys(steps);
  const keys = stepIndices.map((index) => sourceKeys[index] ?? '');
  const names = edits?.stored.stepNames ?? NO_NAMES;

  const write = async (key: string, name: string) => {
    const previous = queryClient.getQueryData(queryKey) ?? edits;
    if (!previous) return;
    const nameFor = (stored: StoredReplayEdits): ReplayEdits => {
      const { stepNames: _old, ...rest } = editListOf(stored);
      const next = withStepName(stored.stepNames, key, name);
      return next ? { ...rest, stepNames: next } : rest;
    };
    const { stepNames: _shown, ...unnamed } = previous.stored;
    const optimistic = nameFor(previous.stored).stepNames;
    queryClient.setQueryData(queryKey, { ...previous, stored: { ...unnamed, ...(optimistic ? { stepNames: optimistic } : {}) } });
    try {
      let current = previous;
      for (let attempt = 0; ; attempt++) {
        try {
          const saved = await saveEdits(replayId, nameFor(current.stored), current.etag);
          queryClient.setQueryData(queryKey, saved);
          return;
        } catch (error) {
          if (!(error instanceof EditsConflictError) || attempt > 0) throw error;
          current = error.current;
        }
      }
    } catch (error) {
      queryClient.setQueryData(queryKey, previous);
      notify('Could not rename the step', 'error', error instanceof Error ? error.message : undefined);
    }
  };

  return {
    names,
    keys,
    allowed: enabled && mayRename(viewer, people),
    store,
    start: (index, surface, label, wasPlaying) => {
      const key = keys[index];
      if (key) store.dispatch({ type: 'start', key, surface, label, ...(wasPlaying === undefined ? {} : { wasPlaying }) });
    },
    change: (draft) => store.dispatch({ type: 'change', draft }),
    finish: (action) => {
      const current = store.get();
      store.dispatch({ type: 'end' });
      if (!current || action === 'cancel') return;
      const name = renameResult(current, action === 'reset');
      if (name === undefined) return;
      queue.current = queue.current.then(() => write(current.key, name));
    },
  };
}

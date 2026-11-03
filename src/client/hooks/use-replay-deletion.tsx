import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { INDEX_SESSIONS_KEY } from '../index/index-queries.ts';
import { changeReplayStorage } from '../queries.ts';
import { indexHref } from '../routing/links.ts';
import { navigate } from '../routing/navigate.ts';
import { notify } from '../toast.ts';
import { ReplayDeleteDialog } from '../viewer/ReplayDeleteDialog.tsx';

/** Deletes one exact recording; the server retains authority over access, keeps and restoration. */
export function useReplayDeletion(id: string, title: string, leaveAfterDelete = false) {
  const client = useQueryClient();
  const [target, setTarget] = useState<{ id: string; title: string } | null>(null);
  const mutation = useMutation({
    mutationFn: (recording: { id: string; title: string }) => changeReplayStorage(recording.id, 'trash'),
    onSuccess: async (_, recording) => {
      setTarget(null);
      notify('Replay moved to trash');
      if (leaveAfterDelete) navigate(indexHref(), { replace: true });
      await Promise.all([
        client.invalidateQueries({ queryKey: INDEX_SESSIONS_KEY }),
        client.invalidateQueries({ queryKey: ['data-storage'] }),
        client.invalidateQueries({ queryKey: ['suite'] }),
        client.invalidateQueries({ queryKey: ['replay', recording.id], exact: true, refetchType: 'none' }),
      ]);
    },
  });
  const requestDelete = () => {
    mutation.reset();
    setTarget({ id, title });
  };
  return {
    requestDelete,
    dialog: (
      <ReplayDeleteDialog
        title={target?.title ?? title}
        open={target !== null}
        pending={mutation.isPending}
        error={mutation.isError ? mutation.error.message : undefined}
        close={() => setTarget(null)}
        submit={() => {
          if (target && !mutation.isPending) mutation.mutate(target);
        }}
      />
    ),
  };
}

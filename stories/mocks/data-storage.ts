import { http, HttpResponse } from 'msw';

import type { DataStorageInfo } from '../../src/shared/data-storage.ts';

const policy = { days: 30, profiles: { triage: 7 }, hasRules: true, expiredDays: 14, trashDays: 7 };
const entry = (id: string) => ({ id, deletedAt: '2026-10-25T12:00:00.000Z', restorableUntil: '2026-11-01T12:00:00.000Z' });

/** Stateful network boundary for a confirmed trash/restore workflow, reset before every story run. */
export function storageSettings() {
  let trash = [entry('old-replay')];
  let deletions = 0;
  return {
    reset: () => {
      trash = [entry('old-replay')];
      deletions = 0;
    },
    deletions: () => deletions,
    handlers: [
      http.get('*/api/data-storage', () =>
        HttpResponse.json({ backend: 'gcs', replayCount: 2, retention: policy, trash } satisfies DataStorageInfo),
      ),
      http.post('*/api/data-storage/trash', () => {
        deletions++;
        trash = [...trash, entry('replay-one'), entry('replay-two')];
        return HttpResponse.json({ trashed: 2, protected: 0, unavailable: 0, failed: 0 });
      }),
      http.delete('*/api/replays/:id', ({ params }) => {
        deletions++;
        trash = [...trash, entry(String(params.id))];
        return HttpResponse.json({
          trashed: { by: 'viewer', at: '2026-10-25T12:00:00.000Z' },
          restorableUntil: '2026-11-01T12:00:00.000Z',
        });
      }),
      http.post('*/api/replays/:id/restore', ({ params }) => {
        trash = trash.filter((item) => item.id !== params.id);
        return HttpResponse.json({ id: params.id });
      }),
    ],
  };
}

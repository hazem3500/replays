import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { formatClock } from '../../../shared/replay.ts';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx';
import { indexReplaysQuery } from '../../index/index-queries.ts';
import { plural } from '../../plural.ts';
import { MAX_TILES } from './url.ts';

export const ADD_STRINGS = {
  title: 'Add recordings',
  description: 'Pick recordings from this workspace to play alongside the others',
  search: 'Filter by title or host',
  empty: 'No recordings match',
  loading: 'Loading recordings',
  failed: 'Could not load recordings',
  limit: `Up to ${MAX_TILES} recordings can play together`,
  cancel: 'Cancel',
  add: (count: number) => (count ? `Add ${plural(count, 'recording')}` : 'Add recordings'),
} as const;

/** Multi-select over the index's recordings; ones already in the comparison are listed as included. */
export function AddReplays({
  open,
  onOpenChange,
  present,
  onAdd,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  present: readonly string[];
  onAdd(ids: string[]): void;
}) {
  const list = useQuery({ ...indexReplaysQuery(''), enabled: open });
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const room = MAX_TILES - present.length;
  const needle = filter.trim().toLowerCase();
  const rows = (list.data ?? [])
    .filter((replay) => !needle || `${replay.title} ${replay.host}`.toLowerCase().includes(needle))
    .slice(0, 200);
  const close = (next: boolean) => {
    if (!next) setPicked([]);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="mt-add sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[length:var(--text-md)] font-semibold">{ADD_STRINGS.title}</DialogTitle>
          <DialogDescription>{room > 0 ? ADD_STRINGS.description : ADD_STRINGS.limit}</DialogDescription>
        </DialogHeader>
        <input
          className="mt-add-filter"
          type="search"
          placeholder={ADD_STRINGS.search}
          aria-label={ADD_STRINGS.search}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <div className="mt-add-list" role="group" aria-label={ADD_STRINGS.title} aria-busy={list.isPending}>
          {list.isPending ? (
            <p className="mt-add-note">{ADD_STRINGS.loading}</p>
          ) : list.isError ? (
            <p className="mt-add-note" role="alert">
              {ADD_STRINGS.failed}
            </p>
          ) : rows.length === 0 ? (
            <p className="mt-add-note">{ADD_STRINGS.empty}</p>
          ) : (
            rows.map((replay) => {
              const included = present.includes(replay.id);
              const checked = included || picked.includes(replay.id);
              const full = !checked && picked.length >= room;
              return (
                <label key={replay.id} className="mt-add-row" data-included={included || undefined}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={included || full}
                    onChange={(event) =>
                      setPicked((current) => (event.target.checked ? [...current, replay.id] : current.filter((id) => id !== replay.id)))
                    }
                  />
                  <span className="mt-add-title">{replay.title || replay.id}</span>
                  <span className="mt-add-meta">
                    {replay.host} · {formatClock(replay.duration)}
                    {replay.consoleErrors + replay.failedRequests
                      ? ` · ${plural(replay.consoleErrors + replay.failedRequests, 'error')}`
                      : ''}
                  </span>
                </label>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            {ADD_STRINGS.cancel}
          </Button>
          <Button
            disabled={!picked.length}
            onClick={() => {
              onAdd(picked);
              close(false);
            }}
          >
            {ADD_STRINGS.add(picked.length)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

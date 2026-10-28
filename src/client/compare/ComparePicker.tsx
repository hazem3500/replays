import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { formatClock, type ReplaySummary } from '../../shared/replay.ts';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx';
import { plural } from '../plural.ts';
import { indexReplaysQuery } from '../index/index-queries.ts';
import { type Comparable, rankCandidates } from './candidates.ts';
import { MAX_RECORDINGS } from './compare-search.ts';

const PICKER_STRINGS = {
  title: 'Compare with…',
  description: (title: string) => `Play another recording beside “${title}” on one timeline.`,
  search: 'Filter by title or host',
  similar: 'Likely matches',
  others: 'Other recordings',
  empty: 'No other recordings match',
  loading: 'Loading recordings',
  failed: 'Could not load recordings',
  full: `Up to ${MAX_RECORDINGS} recordings fit on one stage. Remove one to add another.`,
} as const;

/**
 * "Compare with…": recordings of the same scenario, title or page first, then everything else. Picking one adds
 * it to the stage; the viewer decides what that means for its URL.
 */
export function ComparePicker({
  base,
  exclude,
  open,
  onOpenChange,
  onPick,
}: {
  base: Comparable;
  /** Already on the stage. */
  exclude: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (id: string) => void;
}) {
  const list = useQuery({ ...indexReplaysQuery(''), enabled: open });
  const [filter, setFilter] = useState('');
  const full = exclude.length >= MAX_RECORDINGS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="compare-picker sm:max-w-lg" data-testid="compare-picker">
        <DialogHeader>
          <DialogTitle className="text-[length:var(--text-md)] font-semibold">{PICKER_STRINGS.title}</DialogTitle>
          <DialogDescription>{PICKER_STRINGS.description(base.title || base.id)}</DialogDescription>
        </DialogHeader>
        {full ? (
          <p className="compare-picker-note" role="status">
            {PICKER_STRINGS.full}
          </p>
        ) : (
          <>
            <input
              className="compare-picker-filter"
              type="search"
              placeholder={PICKER_STRINGS.search}
              aria-label={PICKER_STRINGS.search}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <div className="compare-picker-list" aria-busy={list.isPending}>
              <PickerList base={base} exclude={exclude} filter={filter} list={list} onPick={onPick} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PickerList({
  base,
  exclude,
  filter,
  list,
  onPick,
}: {
  base: Comparable;
  exclude: readonly string[];
  filter: string;
  list: { data?: ReplaySummary[] | undefined; isPending: boolean; isError: boolean };
  onPick: (id: string) => void;
}) {
  if (list.isPending) return <p className="compare-picker-note">{PICKER_STRINGS.loading}</p>;
  if (list.isError)
    return (
      <p className="compare-picker-note" role="alert">
        {PICKER_STRINGS.failed}
      </p>
    );
  const needle = filter.trim().toLowerCase();
  const matching = (list.data ?? []).filter(
    (replay) => !exclude.includes(replay.id) && (!needle || `${replay.title} ${replay.host}`.toLowerCase().includes(needle)),
  );
  const { similar, others } = rankCandidates(base, matching);
  const groups = [
    { id: 'similar', label: PICKER_STRINGS.similar, rows: similar },
    { id: 'others', label: PICKER_STRINGS.others, rows: others.slice(0, 200) },
  ].filter((group) => group.rows.length);
  if (!groups.length) return <p className="compare-picker-note">{PICKER_STRINGS.empty}</p>;
  return groups.map((group) => (
    <section key={group.id} aria-label={group.label}>
      <h3 className="compare-picker-heading">{group.label}</h3>
      {group.rows.map((replay) => (
        <PickerRow key={replay.id} replay={replay} onPick={onPick} />
      ))}
    </section>
  ));
}

function PickerRow({ replay, onPick }: { replay: ReplaySummary; onPick: (id: string) => void }) {
  const errors = replay.consoleErrors + replay.failedRequests;
  return (
    <button type="button" className="compare-picker-row" onClick={() => onPick(replay.id)}>
      <span className="compare-picker-title">{replay.title || replay.id}</span>
      <span className="compare-picker-meta">
        {replay.host} · {formatClock(replay.duration)}
        {errors ? ` · ${plural(errors, 'error')}` : ''}
      </span>
    </button>
  );
}

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { formatClock } from '../../shared/replay.ts';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx';
import { indexReplaysQuery } from '../index/index-queries.ts';
import { plural } from '../plural.ts';
import { type Comparable, rankCandidates } from './candidates.ts';
import { meetingHref } from './meeting/meeting-href.ts';
import './compare-picker.css';

export const PICKER_STRINGS = {
  title: 'Compare with…',
  description: (title: string) => `Pick a recording to play beside “${title}” on one timeline`,
  search: 'Filter by title or host',
  similar: 'Likely matches',
  others: 'Other recordings',
  empty: 'No other recordings match',
  loading: 'Loading recordings',
  failed: 'Could not load recordings',
} as const;

/**
 * "Compare with…" from the viewer: an ad-hoc pair outside any suite. Recordings of the same scenario, title or page
 * come first; choosing one opens both on /compare.
 */
export function ComparePicker({ base, open, onOpenChange }: { base: Comparable; open: boolean; onOpenChange(open: boolean): void }) {
  const list = useQuery({ ...indexReplaysQuery(''), enabled: open });
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const matching = (list.data ?? []).filter((replay) => !needle || `${replay.title} ${replay.host}`.toLowerCase().includes(needle));
  const { similar, others } = rankCandidates(base, matching);
  const groups = [
    { id: 'similar', label: PICKER_STRINGS.similar, rows: similar },
    { id: 'others', label: PICKER_STRINGS.others, rows: others.slice(0, 200) },
  ].filter((group) => group.rows.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="compare-picker sm:max-w-lg" data-testid="compare-picker">
        <DialogHeader>
          <DialogTitle className="text-[length:var(--text-md)] font-semibold">{PICKER_STRINGS.title}</DialogTitle>
          <DialogDescription>{PICKER_STRINGS.description(base.title || base.id)}</DialogDescription>
        </DialogHeader>
        <input
          className="compare-picker-filter"
          type="search"
          placeholder={PICKER_STRINGS.search}
          aria-label={PICKER_STRINGS.search}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <div className="compare-picker-list" aria-busy={list.isPending}>
          {list.isPending ? (
            <p className="compare-picker-note">{PICKER_STRINGS.loading}</p>
          ) : list.isError ? (
            <p className="compare-picker-note" role="alert">
              {PICKER_STRINGS.failed}
            </p>
          ) : groups.length === 0 ? (
            <p className="compare-picker-note">{PICKER_STRINGS.empty}</p>
          ) : (
            groups.map((group) => (
              <section key={group.id} aria-label={group.label}>
                <h3 className="compare-picker-heading">{group.label}</h3>
                {group.rows.map((replay) => (
                  <a
                    key={replay.id}
                    className="compare-picker-row"
                    href={meetingHref({ ids: [base.id, replay.id] })}
                    onClick={() => onOpenChange(false)}
                  >
                    <span className="compare-picker-title">{replay.title || replay.id}</span>
                    <span className="compare-picker-meta">
                      {replay.host} · {formatClock(replay.duration)}
                      {replay.consoleErrors + replay.failedRequests
                        ? ` · ${plural(replay.consoleErrors + replay.failedRequests, 'error')}`
                        : ''}
                    </span>
                  </a>
                ))}
              </section>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, useId, useState } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';

import type { ProfileInfo } from '../../shared/profiles.ts';
import { nounFor } from '../plural.ts';
import { expiredReason, expiredReplaysQuery, recordedOn, visibleExpired } from './expired-query.ts';

/**
 * Below the feed: how many replays retention removed recently, and "Show expired" to list them, dimmed, with when and
 * why each went. Rows are details only: the recordings are gone, so there is nothing to open. Absent when the
 * deployment keeps no records or none match the search and profile.
 */
export function ExpiredReplays({
  query,
  profile,
  profiles,
}: {
  query: string;
  profile: string | undefined;
  profiles: readonly ProfileInfo[];
}) {
  const { data } = useQuery(expiredReplaysQuery);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const records = data ? visibleExpired(data.records, { query, profile }) : [];
  if (!data?.days || records.length === 0) return null;
  return (
    <section className="expired" aria-label="Expired replays" data-open={open || undefined}>
      <div className="expired-bar">
        <p className="expired-summary">
          {records.length} {nounFor(records.length, 'replay')} expired in the last {data.days} days
        </p>
        <button type="button" className="expired-toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
          {open ? 'Hide expired' : 'Show expired'}
          <AnimatedIcon name="chevron-down" />
        </button>
      </div>
      <div id={listId} className="expired-panel" hidden={!open}>
        <ul className="expired-list">
          {records.map((record, index) => {
            const stagger: CSSProperties & { '--i': number } = { '--i': index };
            return (
              <li key={record.id} className="expired-row" style={stagger}>
                <span className="expired-tile" aria-hidden="true" />
                <span className="expired-text">
                  <span className="expired-title">{record.title}</span>
                  <span className="expired-meta">
                    {record.host} · {recordedOn(record)}
                  </span>
                  <span className="expired-reason">{expiredReason(record, profiles)}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="expired-hint">Expired replays can no longer be opened. Keep a replay to hold on to it past its window.</p>
      </div>
    </section>
  );
}

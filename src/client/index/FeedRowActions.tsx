import { useRef } from 'react';

import { useKeepButtonMotion } from '../hooks/use-feed-control-motion.ts';
import type { ReplaySummary } from '../../shared/replay.ts';
import { daysUntil, useKeep } from '../viewer/keep.ts';

/** Rows within this many days of expiring say so (retention removes them; nothing is shown after). */
const EXPIRY_HINT_DAYS = 7;

/** "Expires in 3 days" (the full date as its tooltip) and a Keep button, for a replay about to expire. */
export function ExpiryHint({ summary }: { summary: ReplaySummary }) {
  const { expiresAt } = summary;
  if (!expiresAt || summary.kept || daysUntil(expiresAt) > EXPIRY_HINT_DAYS) return null;
  return <Expiry id={summary.id} title={summary.title} expiresAt={expiresAt} />;
}

/** Mounted only for rows about to expire, so only they ask for their retention (useKeep shares the viewer's cache). */
function Expiry({ id, title, expiresAt }: { id: string; title: string; expiresAt: string }) {
  const keep = useKeep(id);
  const button = useRef<HTMLButtonElement>(null);
  useKeepButtonMotion(button, keep.available && !keep.kept);
  if (keep.kept) return null;
  const days = daysUntil(expiresAt);
  const full = new Date(expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <span className="feed-expiry">
      <time dateTime={expiresAt} title={`Expires ${full}`}>
        {days === 0 ? 'Expires today' : `Expires in ${days} ${days === 1 ? 'day' : 'days'}`}
      </time>
      {keep.available ? (
        <button ref={button} type="button" className="feed-keep" onClick={keep.flip} disabled={keep.pending} aria-label={`Keep ${title}`}>
          Keep
        </button>
      ) : null}
    </span>
  );
}

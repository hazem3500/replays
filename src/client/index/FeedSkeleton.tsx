import { type ReactNode, useState } from 'react';

import type { ReplaySummary } from '../../shared/replay.ts';
import { Feed, type FeedEntry, type FeedView } from './Feed.tsx';
import type { FeedShape } from './index-cache.ts';
import { useFeedReveal } from '../hooks/use-feed-reveal.ts';
import { PosterPendingContext } from './Poster.tsx';
import '../loading.css';
import './feed-skeleton.css';

/** Stand-in titles of natural, varied lengths: only their line boxes ever show. */
const TITLES = [
  'Checkout · coupon rejected, order retained',
  'Settings diagnostics',
  'Release smoke · storefront and account pages',
  'Workspace activity',
  'Onboarding · invite teammate and verify email',
  'Search filters persist',
  'Billing · update card after decline',
  'Dashboard first paint',
];
const HOSTS = ['shop.example.test', 'app.example.test', 'docs.example.test', 'admin.example.test'];

/** Stand-in entries for a pending feed: plausible text lengths, no requests (ids are never fetched while pending). */
export function pendingEntries(count: number, now = Date.now()): FeedEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const summary: ReplaySummary = {
      id: `pending-${index}`,
      title: TITLES[index % TITLES.length] ?? '',
      url: `https://${HOSTS[index % HOSTS.length] ?? ''}/`,
      host: HOSTS[index % HOSTS.length] ?? '',
      // why: all within the last hour, so the pending feed draws one day heading, like a real recent list.
      capturedAt: new Date(now - index * 7 * 60_000).toISOString(),
      duration: 8_000 + index * 3_000,
      steps: 0,
      consoleErrors: 0,
      failedRequests: 0,
      source: 'agent',
    };
    return { kind: 'session', id: summary.id, summary };
  });
}

/** The feed's geometry (feed.css), for the viewport cap. */
const GRID_MIN_CARD = 250;
const GRID_GAP = 20;
const GRID_ROW_GAP = 28;
const CARD_BODY = 123;
const LIST_ROW = 85;
const PHONE_ROW = 78;
const DEFAULT_LIST_ROWS = 5;

/** Grid columns and how many rows (or list rows) the viewport shows below the header, counting a partly visible one. */
function viewportFit(view: FeedView, top: number) {
  if (typeof window === 'undefined') return { columns: 1, rows: DEFAULT_LIST_ROWS };
  const width = document.documentElement.clientWidth || window.innerWidth;
  const phone = width <= 640;
  const gutter = phone ? 16 : 32;
  const available = Math.max(0, window.innerHeight - top);
  if (view === 'grid') {
    const inner = width - 2 * gutter;
    const columns = Math.max(1, Math.floor((inner + GRID_GAP) / (GRID_MIN_CARD + GRID_GAP)));
    const card = (inner - (columns - 1) * GRID_GAP) / columns / 1.6 + CARD_BODY;
    return { columns, rows: Math.max(1, Math.ceil((available - GRID_ROW_GAP) / (card + GRID_ROW_GAP))) };
  }
  return { columns: 1, rows: Math.max(1, Math.ceil(available / (phone ? PHONE_ROW : LIST_ROW))) };
}

/** Placeholders to draw: the known count (0 draws none), else one grid row or five list rows; never past the viewport. */
export function skeletonCount(view: FeedView, known?: number, top = 120) {
  const { columns, rows } = viewportFit(view, top);
  const fits = columns * rows;
  const wanted = known ?? (view === 'grid' ? columns : DEFAULT_LIST_ROWS);
  return Math.max(0, Math.min(wanted, fits));
}

/**
 * The feed while its list loads: the real Feed with stand-in entries, inside `.feed-pending` (feed-skeleton.css),
 * which redacts every text to a soft band on the text's own line boxes and draws posters as plain tiles
 * (PosterPendingContext: no requests). Its shapes are the real shapes by construction, so they never drift from the
 * cards they stand for. As many entries as this view showed last time (index-cache.ts), else one grid row or five
 * list rows, never more than the viewport shows. Nothing shows for waits under --skeleton-delay; then it breathes.
 */
export function FeedSkeleton({
  view,
  grouped = true,
  known,
}: {
  view: FeedView;
  /** Sorted by time: the feed has day headings, so the pending one has one too. */
  grouped?: boolean;
  /** How this view looked last time (undefined: never seen in this tab). */
  known?: FeedShape | undefined;
}) {
  const [entries] = useState(() => pendingEntries(skeletonCount(view, known?.count)));
  if (entries.length === 0) return null;
  return (
    <div
      className="feed-pending"
      // why: a suite leading the grid gets the feed's taller top padding (its stack peeks above the cards).
      data-leading-suite={known?.leadingSuite ? '' : undefined}
      data-testid="feed-skeleton"
      aria-hidden="true"
      inert
    >
      <PosterPendingContext value={true}>
        <Feed entries={entries} view={view} grouped={grouped} query="" />
      </PosterPendingContext>
    </div>
  );
}

/**
 * The hand-over from skeleton to whatever arrives (the feed, an empty state, an error): the pending copy fades out
 * item by item as the real cards stagger in beneath, and a shorter result settles instead of collapsing
 * (useFeedReveal).
 */
export function FeedReveal({ loading, skeleton, children }: { loading: boolean; skeleton: ReactNode; children: ReactNode }) {
  const { box, ghost, leaving } = useFeedReveal(loading, skeleton);
  return (
    <div ref={box} className="feed-reveal">
      {loading ? skeleton : children}
      {leaving ? (
        <div ref={ghost} className="feed-reveal-ghost">
          {leaving}
        </div>
      ) : null}
    </div>
  );
}

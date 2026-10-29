import { ArrowRightIcon, LayersIcon } from 'lucide-react';
import { createContext, type PointerEvent, type ReactNode, useContext, useRef } from 'react';

import { formatClock, type ReplaySummary } from '../../shared/replay.ts';
import type { ReviewSuiteIndexEntry, ReviewSuiteIndexRun, SuiteOverallStatus } from '../../shared/review-suite.ts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { cn } from '@/lib/utils.ts';

import { formatRelative } from '../format.ts';
import { replayHref, replayInSuiteHref, suiteHref } from '../route.ts';
import { playableReplayId } from '../suite/runs.ts';
import { errorTotal, feedTime, formatBadgeDuration, runStrip } from './feed.ts';
import { PeopleStack } from './People.tsx';
import { SourceLead, sourceText } from './SourceLine.tsx';
import { IndexColumns } from './PluginSlots.tsx';
import { RunMosaic } from './PosterPlaceholder.tsx';
import { Poster } from './Poster.tsx';
import { previewHandlers, usePreviewActive } from './preview.ts';
import { type SuiteCycle, useShuffle, useSuiteCycle } from './suite-cycle.ts';
import { useIntentPrefetch } from '../intent-prefetch.ts';
import { FeedList, type FeedRowPlace } from './FeedList.tsx';
import { ExpiryHint } from './FeedRowActions.tsx';

/*
 * The replay index as a visual feed: sessions and review suites as rows (list) or cards (grid), each
 * with a poster thumbnail and a line 2 that leads with the replay's source (SourceLine.tsx). Rows are
 * whole-row links (the title's ::after stretches over the row, `.row-target`); the few controls inside
 * a row (source links, run pills, timeline error dots) sit above that hit area.
 */

export type FeedView = 'list' | 'grid';

/** What the feed needs from an index entry (ReplayIndex.tsx builds these). */
export type FeedEntry =
  | { kind: 'session'; id: string; summary: ReplaySummary }
  | {
      kind: 'suite';
      id: string;
      suite: Pick<ReviewSuiteIndexEntry, 'id' | 'title' | 'createdAt' | 'subject' | 'runDetails' | 'people'>;
      status: SuiteOverallStatus;
      runs: ReviewSuiteIndexRun[];
      hiddenRuns: number;
      hosts: string[];
    };

type SuiteFeedEntry = Extract<FeedEntry, { kind: 'suite' }>;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/* ---------- Status ---------- */

export type StatusTone = 'running' | 'passed' | 'failed' | 'partial' | 'waiting';

export const SUITE_STATUS: Record<SuiteOverallStatus, { tone: StatusTone; label: string }> = {
  Waiting: { tone: 'waiting', label: 'Waiting' },
  Running: { tone: 'running', label: 'Running' },
  Failed: { tone: 'failed', label: 'Failed' },
  Partial: { tone: 'partial', label: 'Partial' },
  Complete: { tone: 'passed', label: 'Passed' },
};

export function StatusLabel({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className={`index-status index-status-${tone}`}>
      <span className="index-status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function runStatus(run: ReviewSuiteIndexRun): { tone: StatusTone; label: string } {
  return run.status === 'running'
    ? { tone: 'running', label: 'Running' }
    : !run.replayId
      ? { tone: 'waiting', label: 'No recording' }
      : !run.replay
        ? { tone: 'waiting', label: 'Expired' }
        : { tone: run.status, label: run.status === 'passed' ? 'Passed' : run.status === 'failed' ? 'Failed' : 'Partial' };
}

/** The run whose poster stands for the suite: the first failed recording, else the first recording. */
export function suitePosterRun(runs: readonly ReviewSuiteIndexRun[]) {
  const playable = runs.filter((run) => playableReplayId(run, true));
  return playable.find((run) => run.status === 'failed') ?? playable[0];
}

/* ---------- Small parts ---------- */

/**
 * No hover annotations on rows, except the full title when it is actually cut (two-line clamp or
 * ellipsis), measured when the pointer arrives. The accessible name (aria-label) is unaffected.
 */
function titleIfClamped(event: PointerEvent<HTMLElement>) {
  const element = event.currentTarget;
  const cut = element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1;
  if (cut) element.title = element.textContent ?? '';
  else element.removeAttribute('title');
}

/** The query's first match in `text`, marked. */
function Highlight({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

/** Rows under day headings (Feed, grouped by time): the heading already says the day. */
const GroupedContext = createContext(false);

/**
 * A row's time. Under day headings it doesn't repeat the heading: the time of day under Today/Yesterday, the date
 * and time under older ones (feed.ts feedTime), with the relative time ("17 hours ago") as its tooltip. Without
 * headings (other sorts) it stays relative.
 */
function Relative({ at, narrow }: { at: string; narrow?: boolean }) {
  const grouped = useContext(GroupedContext);
  const relative = formatRelative(at, undefined, 'long');
  return (
    <time dateTime={at} {...(grouped ? { title: relative } : {})}>
      {grouped ? feedTime(at) : formatRelative(at, undefined, narrow ? 'narrow' : 'long')}
    </time>
  );
}

/** The right-hand column on wide list rows: the time over a muted host, fixed width, so it aligns across rows. */
function RowColumns({ at, host }: { at: string; host: string }) {
  // Repeats the row's accessible name, so it's hidden from AT.
  return (
    <div className="feed-cols" aria-hidden="true">
      <span className="feed-when">
        <Relative at={at} />
        {host ? <span className="feed-when-host">{host}</span> : null}
      </span>
    </div>
  );
}

/* ---------- Rows ---------- */

function SessionItem({
  summary,
  view,
  query,
  place,
  rowRef,
}: {
  summary: ReplaySummary;
  view: FeedView;
  query: string;
  place: FeedRowPlace;
  rowRef: ((element: HTMLElement | null) => void) | undefined;
}) {
  const errors = errorTotal(summary);
  const imported = summary.source === 'human';
  const showId = Boolean(query) && summary.id.toLowerCase().includes(query.toLowerCase());
  const href = replayHref(summary.id);
  const playing = usePreviewActive(`session:${summary.id}`);
  // Error counts are details on screen, but still named for screen readers.
  const name = [
    summary.title,
    'Replay',
    formatBadgeDuration(summary.duration),
    summary.sources?.[0] ? `from ${sourceText(summary.sources[0])}` : imported ? 'rrweb import' : 'Agent capture',
    errors ? plural(errors, 'error') : '',
    formatRelative(summary.capturedAt),
    summary.host,
    summary.steps ? plural(summary.steps, 'step') : '',
    showId ? `id ${summary.id}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <li
      ref={rowRef}
      className="feed-item feed-session"
      data-view={view}
      data-entry-id={`session:${summary.id}`}
      data-row={place.index}
      data-index={place.measured ? place.index : undefined}
      data-last={place.last || undefined}
      {...previewHandlers(`session:${summary.id}`)}
    >
      <Poster
        id={summary.id}
        host={summary.host}
        thumbhash={summary.thumbhash}
        url={summary.url}
        size={view === 'grid' ? 'card' : 'row'}
        playing={playing}
        badge={formatBadgeDuration(summary.duration)}
      />
      <div className="feed-body">
        <div className="feed-head">
          <a className="row-target feed-title" href={href} aria-label={name} onPointerEnter={titleIfClamped}>
            {summary.title}
          </a>
        </div>
        <div className="feed-meta">
          <SourceLead sources={summary.sources} origin={summary.source} />
          <PeopleStack people={summary.people} />
          <span className="feed-facts">
            <span>
              <Relative at={summary.capturedAt} narrow={view === 'grid'} />
            </span>
            {summary.host ? <span className="feed-host">{summary.host}</span> : null}
            {showId ? (
              <code className="feed-id">
                <Highlight text={summary.id} query={query} />
              </code>
            ) : null}
          </span>
          <ExpiryHint summary={summary} />
        </div>
        {/* Plugins' fields (registerIndexColumn), drawn from summary.ext. */}
        <IndexColumns summary={summary} />
      </div>
      {view === 'list' ? <RowColumns at={summary.capturedAt} host={summary.host} /> : null}
    </li>
  );
}

/** A run's length for the strip: its recording, else its start → finish. */
function runLength(run: ReviewSuiteIndexRun) {
  if (run.replay) return run.replay.duration;
  const start = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
  const end = run.finishedAt ? Date.parse(run.finishedAt) : Number.NaN;
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : undefined;
}

/**
 * A suite's runs as one small strip (it echoes the product mark): a rounded segment per run, its width following
 * the run's length. Failed runs are red; passed ones neutral; a running one pulses; one without a recording is an
 * outline. The whole strip is one target (24 px, 40 px on touch: segments 10 px apart could never each be one)
 * that opens a small menu of the runs, each a link with its status and length; more than eight end in "+N".
 */
function RunStrip({
  suite,
  runs,
  className,
  compact = false,
  activeId,
}: {
  suite: SuiteFeedEntry['suite'];
  runs: ReviewSuiteIndexRun[];
  className?: string;
  /** The run on the card's front while its preview cycles: its segment is marked. */
  activeId?: string;
  /** Grid cards: at most ~64 px, so the time and commit beside it never truncate. */
  compact?: boolean;
}) {
  const { segments, more } = runStrip(runs, runLength, compact ? { maxPx: 64, minPx: 8 } : {});
  const failed = runs.filter((run) => run.status === 'failed').length;
  const summary = `${plural(runs.length, 'run')}${failed ? `, ${failed} failed` : ''}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn('run-strip', className)} aria-label={`Runs of ${suite.title}: ${summary}`}>
        {segments.map(({ run, width }) => (
          <span
            key={run.id}
            className="run-seg"
            data-tone={runStatus(run).tone}
            data-muted={playableReplayId(run, true) ? undefined : ''}
            data-active={run.id === activeId || undefined}
            style={{ width }}
          />
        ))}
        {more > 0 ? <span className="run-seg-more">+{more}</span> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="run-menu w-auto min-w-56 p-1" aria-label={`Runs of ${suite.title}`}>
        {[...runs]
          .sort((a, b) => a.sequence - b.sequence)
          .map((run) => {
            const status = runStatus(run);
            const sequence = String(run.sequence).padStart(2, '0');
            const playable = playableReplayId(run, true);
            const errors = run.replay ? errorTotal(run.replay) : 0;
            const length = run.replay ? formatClock(run.replay.duration) : '';
            const name = `${sequence} ${run.label}, ${status.label}${errors ? `, ${plural(errors, 'error')}` : ''}${length ? `, ${length}` : ''}`;
            // The segment says how it went (as on the card); the order is the runs' own, so no sequence column.
            const content = (
              <>
                <span className="run-seg" data-tone={status.tone} data-muted={playable ? undefined : ''} aria-hidden="true" />
                <span className="run-menu-label">{run.label}</span>
                <DropdownMenuShortcut className="run-menu-meta">{length || status.label}</DropdownMenuShortcut>
              </>
            );
            return playable ? (
              <DropdownMenuItem
                key={run.id}
                className="run-menu-item"
                aria-label={name}
                render={<a href={replayInSuiteHref(playable, suite.id)} />}
              >
                {content}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem key={run.id} className="run-menu-item" aria-label={name} disabled>
                {content}
              </DropdownMenuItem>
            );
          })}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="run-menu-item run-menu-all" render={<a href={suiteHref(suite.id)} />}>
          Open suite
          <ArrowRightIcon className="run-menu-arrow" aria-hidden="true" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SuiteItem({
  entry,
  view,
  place,
  rowRef,
}: {
  entry: SuiteFeedEntry;
  view: FeedView;
  place: FeedRowPlace;
  rowRef: ((element: HTMLElement | null) => void) | undefined;
}) {
  const { suite } = entry;
  const status = SUITE_STATUS[entry.status];
  const count = suite.runDetails.length;
  const front = suitePosterRun(suite.runDetails);
  const sources = suite.subject ? [suite.subject] : undefined;
  const playing = usePreviewActive(`suite:${suite.id}`);
  // While its preview plays, the card cycles through the suite's runs (suite-cycle.ts).
  const card = useRef<HTMLLIElement>(null);
  const cycle = useSuiteCycle(suite.runDetails, front, playing);
  const capture = useShuffle(card, cycle.step);
  const poster = cycle.current;
  const shownId = poster ? playableReplayId(poster, true) : undefined;
  const host = poster?.replay?.host ?? entry.hosts[0] ?? '';
  // Opening a card mid-cycle opens the suite at the run on screen.
  const href = cycle.cycling && cycle.step > 0 && shownId ? replayInSuiteHref(shownId, suite.id) : suiteHref(suite.id);
  const failed = suite.runDetails.filter((run) => run.status === 'failed').length;
  const name = [
    suite.title,
    'Review suite',
    plural(count, 'run'),
    failed ? `${failed} failed` : status.label,
    suite.subject ? sourceText(suite.subject) : '',
    formatRelative(suite.createdAt),
  ]
    .filter(Boolean)
    .join(', ');
  const facts = (
    <span className="feed-facts">
      <span>
        <Relative at={suite.createdAt} narrow={view === 'grid'} />
      </span>
    </span>
  );
  // Per-run status lives in the run strip (no outcome line): in the meta line (grid, narrow lists) or in the
  // Size column next to "N runs" (wide lists). Only one of the two is ever displayed.
  const strip = (className?: string) =>
    entry.runs.length > 0 ? (
      <RunStrip
        suite={suite}
        runs={entry.runs}
        compact={view === 'grid'}
        {...(cycle.cycling && poster ? { activeId: poster.id } : {})}
        {...(className ? { className } : {})}
      />
    ) : (
      <span className={cn('run-strip-note', className)}>No runs yet</span>
    );
  return (
    <li
      ref={(node) => {
        card.current = node;
        rowRef?.(node);
      }}
      className="feed-item feed-suite"
      data-view={view}
      data-entry-id={`suite:${suite.id}`}
      data-row={place.index}
      data-index={place.measured ? place.index : undefined}
      data-last={place.last || undefined}
      {...previewHandlers(`suite:${suite.id}`)}
    >
      {view === 'grid' ? (
        <>
          <CardBacks runs={suite.runDetails} front={poster} />
          <Poster
            id={shownId}
            host={host}
            fallback={<RunMosaic runs={suite.runDetails} />}
            size="card"
            playing={playing}
            badge={<RunsBadge count={count} />}
            {...cyclePosterProps(cycle, capture)}
          />
        </>
      ) : (
        <PosterStack runs={suite.runDetails} front={poster}>
          <Poster
            id={shownId}
            host={host}
            fallback={<RunMosaic runs={suite.runDetails} />}
            size="row"
            playing={playing}
            badge={<RunsBadge count={count} />}
            {...cyclePosterProps(cycle, capture)}
          />
        </PosterStack>
      )}
      <div className="feed-body">
        <div className="feed-head">
          <a className="row-target feed-title" href={href} aria-label={name} onPointerEnter={titleIfClamped}>
            {suite.title}
          </a>
        </div>
        <div className="feed-meta">
          <span className="source-lead source-lead-plain suite-kind">
            <LayersIcon className="source-mark" aria-hidden="true" />
            Review suite
          </span>
          {sources ? <SourceLead sources={sources} origin="agent" short /> : null}
          <PeopleStack people={suite.people} />
          {view === 'list' ? facts : null}
          {view === 'list' ? strip() : null}
        </div>
        {/* Grid: the time on the left, the run pills right-aligned on the same line, so suite cards are no
            taller than their neighbours (the same three lines: title, source, facts). */}
        {view === 'grid' ? (
          <div className="feed-meta feed-meta-end">
            {facts}
            {strip()}
          </div>
        ) : null}
      </div>
      {/* The same trailing column as replays: the time over a muted host. */}
      {view === 'list' ? <RowColumns at={suite.createdAt} host={host} /> : null}
    </li>
  );
}

/** Sheets behind a suite's front card, back to front: one per other run, at most two. */
function stackLayers(runCount: number): number[] {
  return runCount >= 3 ? [2, 1] : runCount === 2 ? [1] : [];
}

/** The runs drawn on the sheets behind the front poster (nearest first): recorded runs before the rest. */
function backRuns(runs: readonly ReviewSuiteIndexRun[], front: ReviewSuiteIndexRun | undefined) {
  const others = runs.filter((run) => run !== front);
  const ordered = [...others.filter((run) => playableReplayId(run, true)), ...others.filter((run) => !playableReplayId(run, true))];
  return stackLayers(runs.length).map((layer) => ({ layer, run: ordered[layer - 1] }));
}

/**
 * Another run's screenshot on a back sheet: cropped below the recorded app's own header (feed.css), dimmed so
 * the front stays dominant. A run without a recording leaves the sheet plain.
 */
function BackPoster({ run }: { run: ReviewSuiteIndexRun | undefined }) {
  const id = run ? playableReplayId(run, true) : undefined;
  return id ? <Poster id={id} host={run?.replay?.host ?? ''} size="fill" className="back-poster" /> : null;
}

/**
 * A suite's thumbnail as a pile: the front poster plus one plain sheet per other run (at most two) behind it.
 * While the row is hovered or reached by keyboard the sheets fan out a little (feed.css); the hover preview starts later, after its intent delay.
 */
function PosterStack({
  runs,
  front,
  children,
}: {
  runs: ReviewSuiteIndexRun[];
  front: ReviewSuiteIndexRun | undefined;
  children: ReactNode;
}) {
  return (
    <span className="poster-stack" aria-hidden="true">
      {backRuns(runs, front).map(({ layer, run }) => (
        <span key={layer} className={`stack-layer stack-layer-${layer}`}>
          <BackPoster run={run} />
        </span>
      ))}
      <span className="stack-front">{children}</span>
    </span>
  );
}

/**
 * Grid suites as an album stack (Apple Photos style): card-shaped plain sheets behind the whole card, centred,
 * peeking above its top edge; one per other run (at most two). Per-run status lives in the run pills.
 */
function CardBacks({ runs, front }: { runs: ReviewSuiteIndexRun[]; front: ReviewSuiteIndexRun | undefined }) {
  return (
    <>
      {backRuns(runs, front).map(({ layer, run }) => (
        <span
          key={layer}
          className={`card-back card-back-${layer}`}
          aria-hidden="true"
          // The backs are part of the card: a click on the strip above it opens the suite, like the card.
          onClick={(event) => event.currentTarget.closest('li')?.querySelector<HTMLAnchorElement>('.row-target')?.click()}
        >
          <BackPoster run={run} />
        </span>
      ))}
    </>
  );
}

/**
 * A cycling suite card's front poster props: the run on screen, played once (then the stack shuffles to the next),
 * the next one warmed past halfway, and a short "02 · Desktop: login only" label on each change.
 */
function cyclePosterProps(cycle: SuiteCycle, capture: () => void) {
  const run = cycle.current;
  if (!cycle.cycling) return {};
  return {
    onPreviewEnd: () => {
      capture();
      cycle.advance();
    },
    onPreviewHalf: cycle.warmNext,
    ...(cycle.step > 0 && run
      ? {
          caption: (
            <span key={cycle.step} className="poster-caption">
              {String(run.sequence).padStart(2, '0')} · {run.label}
            </span>
          ),
        }
      : {}),
  };
}

/** "2 runs" with a stack glyph, on a suite's thumbnail. */
function RunsBadge({ count }: { count: number }) {
  return (
    <>
      <LayersIcon aria-hidden="true" />
      {plural(count, 'run')}
    </>
  );
}

/* ---------- Lists ---------- */

export { entryTime } from './feed-layout.ts';

/** The feed: day groups with sticky headings when sorted by time, else one flat list (FeedList.tsx lays it out). */
export function Feed({ entries, view, grouped, query }: { entries: FeedEntry[]; view: FeedView; grouped: boolean; query: string }) {
  useIntentPrefetch(entries);
  return (
    <GroupedContext.Provider value={grouped}>
      <FeedList
        entries={entries}
        view={view}
        grouped={grouped}
        renderEntry={(entry, place, rowRef) =>
          entry.kind === 'session' ? (
            <SessionItem key={`session:${entry.id}`} summary={entry.summary} view={view} query={query} place={place} rowRef={rowRef} />
          ) : (
            <SuiteItem key={`suite:${entry.id}`} entry={entry} view={view} place={place} rowRef={rowRef} />
          )
        }
      />
    </GroupedContext.Provider>
  );
}

export function FeedSkeleton({ view }: { view: FeedView }) {
  return (
    <ul className="feed-list feed-skeleton" data-view={view} aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <li key={row} className="feed-item" data-view={view}>
          <span className={`poster poster-${view === 'grid' ? 'card' : 'row'}`} />
          <div className="feed-body">
            <span className="skeleton" style={{ width: `${70 - row * 6}%` }} />
            <span className="skeleton skeleton-thin" style={{ width: '40%' }} />
            <span className="skeleton mini-timeline-skeleton" />
          </div>
        </li>
      ))}
    </ul>
  );
}

import { StateView } from '@/components/ui/state-view.tsx';
import { FailureShell, failureCopy, TRY_AGAIN } from '../routing/states.tsx';
import { SignInError, useSignInRedirect } from '../sign-in.tsx';
import { readSplitterSize, Splitter } from '../components/ui/splitter.tsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { plural } from '../plural.ts';
import { displayTitle } from '../display-title.ts';
import { PanelLeftCloseIcon, PanelLeftOpenIcon, PinIcon } from 'lucide-react';
import { type KeyboardEvent, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Hint, IconButton } from '@/components/icon-button.tsx';
import { cssVars } from '../lib/css-vars.ts';
import { HoverGlide, useSlidingHighlight } from '@/components/sliding-highlight.tsx';
import { StatusLabel, type StatusTone } from '@/components/ui/status-label.tsx';
import { DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu.tsx';

import { formatClock } from '../../shared/replay.ts';
import { type ReviewSuite, type ReviewSuiteIndexRun, suiteOverallStatus } from '../../shared/review-suite.ts';
import { productName } from '../config.ts';
import { prefetchReplay, replayQuery, type SuiteWithRuns, suiteQuery } from '../queries.ts';
import { setPageUrl } from '../routing/navigate.ts';
import { swapInPlace } from '../transitions/swap.ts';
import { indexReturnHref, replayInSuiteHref, suiteHref, suiteRunOf } from '../routing/links.ts';
import { shortcutFor, shortcutLabel } from '../shortcuts.ts';
import { MOBILE_QUERY, useMediaQuery } from '../media.ts';
import { Topbar } from '../Topbar.tsx';
import { EditedViewer } from '../Viewer.tsx';
import { editsQuery } from '../edits.ts';
import { ViewerSkeleton } from '../ViewerSkeleton.tsx';
import { useKeepSuite } from '../viewer/keep.ts';
import type { SuiteDetails } from '../viewer/ReplayInfo.tsx';
import { SummaryText } from '../viewer/SummaryText.tsx';
import type { InspectorTab } from '../viewer/context.ts';
import {
  initialRunReplayId,
  isExpired,
  neighbourReplayId,
  orderedRuns,
  playableReplayId,
  type RecordedRun,
  recordedRuns,
  type RunMetric,
  runRowMetrics,
} from './runs.ts';
import { isPerformanceFocused } from '../../shared/performance-focus.ts';
import { pageProfiles } from '../profiles.ts';
import { SuiteExpired } from './SuiteExpired.tsx';
import { compareDefaults, isComparisonView, suiteViewLayout } from '../compare/defaults.ts';
import { monograms, shortNames } from '../compare/tiles.ts';
import { usePanelMotion } from '../hooks/use-panel-motion.ts';
import { usePageView } from '../hooks/use-page-view.ts';
import { suiteComparePage } from '../routing/pages.ts';

// why: intent and route preparation share this cache so a warmed comparison does not suspend for another frame.
const SuiteCompare = suiteComparePage.Component;

type WorkspaceRun = ReviewSuiteIndexRun & { duration?: number };

/** A run whose recording did not load: gone for good (expired or removed), or worth another try. */
function RunUnavailable({ message }: { message: string }) {
  if (message === 'Replay not found')
    return <StateView kind="not-found" title="This run’s recording is gone" cause="It has expired or was removed." />;
  const { kind, title, cause, details } = failureCopy('run', message);
  return <StateView kind={kind} title={title} cause={cause} details={details} actions={{ primary: TRY_AGAIN }} />;
}

/** Run rows from `runDetails` when present, else from the plain runs (no per-run error counts then). */
function workspaceRuns(suite: SuiteWithRuns | undefined): WorkspaceRun[] {
  if (!suite) return [];
  const recordings = new Map(suite.runs.map((run) => [run.id, run.recording?.duration]));
  const rows: WorkspaceRun[] = suite.runDetails
    ? suite.runDetails.map((run) => {
        const duration = run.replay?.duration ?? recordings.get(run.id);
        return duration === undefined ? run : { ...run, duration };
      })
    : suite.runs.map(({ id, sequence, label, status, startedAt, finishedAt, replayId, recording, summary }) => ({
        id,
        sequence,
        label,
        status,
        startedAt,
        ...(summary ? { summary } : {}),
        ...(finishedAt ? { finishedAt } : {}),
        ...(replayId ? { replayId } : {}),
        ...(recording ? { duration: recording.duration } : {}),
      }));
  return orderedRuns(rows);
}

/** The suite's subject as a link (provider, address, label), when it names one. */
function subjectLink(suite: Pick<ReviewSuite, 'subject'>): SuiteDetails['subject'] {
  const { subject } = suite;
  return subject ? { provider: subject.provider, url: subject.url, label: subject.label ?? subject.ref ?? '' } : undefined;
}

function runErrors(run: ReviewSuiteIndexRun) {
  return (run.replay?.consoleErrors ?? 0) + (run.replay?.failedRequests ?? 0);
}

function sequenceLabel(run: Pick<ReviewSuiteIndexRun, 'sequence'>) {
  return String(run.sequence).padStart(2, '0');
}

function statusTone(run: ReviewSuiteIndexRun, detailed: boolean) {
  if (run.status === 'running') return 'running';
  if (!playableReplayId(run, detailed)) return 'waiting';
  return run.status;
}

/**
 * The suite workspace: a runs sidebar (collapsible to a slim rail, replaced by
 * a run switcher at ≤ 720 px) next to the full viewer for the selected run.
 * Switching runs swaps the replay in place and pushes history, so back and
 * forward move between runs.
 */
export function SuiteWorkspace({ id, replayId: initialReplayId }: { id: string; replayId?: string }) {
  // The suite renders from cache at once and refreshes in the background (window return, 30 s staleness), so new
  // runs show up; bundles come from the capped replay cache (queries.ts), so switching back is instant.
  const { data: suite, error: suiteFailure } = useQuery(suiteQuery(id));
  const error = suiteFailure ? suiteFailure.message : '';
  const [chosen, setSelected] = useState(initialReplayId);
  // `/s/<suite>` lands on the first failed run (else the first recording) until a run is picked.
  const landing = useMemo(
    () => (suite && !initialReplayId ? initialRunReplayId(workspaceRuns(suite), Boolean(suite.runDetails)) : undefined),
    [initialReplayId, suite],
  );
  const selected = chosen ?? landing;
  const { data: bundle, error: bundleFailure } = useQuery({ ...replayQuery(selected ?? ''), enabled: Boolean(selected) });
  const bundleError = bundleFailure ? bundleFailure.message : '';
  // Runs show their saved edits too; a failed load shows the run as recorded.
  const edits = useQuery({ ...editsQuery(selected ?? ''), enabled: Boolean(selected) });
  const editsSettled = edits.data !== undefined || edits.isError;
  // An observed auth failure must win over cached suite, bundle or edit data.
  const authFailure = [suiteFailure, bundleFailure, edits.error].find((candidate) => candidate instanceof SignInError);
  const signingIn = useSignInRedirect(authFailure);
  const [tab, setTab] = useState<InspectorTab>('console');
  // A suite always opens with the runs sidebar expanded; collapsing it only lasts for this visit.
  const [collapsed, setRailPreference] = useState(false);
  const narrow = useMediaQuery(MOBILE_QUERY);
  const workspace = useRef<HTMLDivElement>(null);
  const panelMotion = usePanelMotion();
  const [sidebarWidth, setSidebarWidth] = useState(() => readSplitterSize('suite-sidebar-width', 256, 240, 400));

  // The landing run goes into the URL without adding a history entry, and is pinned so a background
  // refresh of the suite (a run that failed meanwhile) cannot move the viewer to another run.
  useEffect(() => {
    if (chosen || !landing) return;
    setPageUrl(`${replayInSuiteHref(landing, id)}${location.search}${location.hash}`);
    // oxlint-disable-next-line react/set-state-in-effect -- pins a value already on screen; no visible re-render
    setSelected(landing);
  }, [chosen, id, landing]);

  const runs = useMemo(() => workspaceRuns(suite), [suite]);
  const detailed = Boolean(suite?.runDetails);
  // why: retain every playable run for layout switching even when entry shows only the selected run.
  const playable = recordedRuns(runs, detailed);
  const view = usePageView({ replay: bundle, suiteProfile: suite?.profile, recordings: 1 });
  const performanceFocused = isPerformanceFocused({
    view: view.view.id,
    profiles: [pageProfiles().find((profile) => profile.id === suite?.profile)],
  });
  const defaults = compareDefaults({
    page: 'suite',
    recordings: playable.length,
    viewLayout: suiteViewLayout(view),
  });
  const comparing = defaults.compare && isComparisonView(view);

  // The run being switched to: the sidebar's selection moves at once, the viewer once its data is in (or after a
  // short wait), as one calm in-place transition (transitions/swap.ts).
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string>();
  const target = pending ?? selected;
  const switchTo = useCallback(
    (replayId: string | undefined, instant = false) => {
      setPending(replayId);
      swapInPlace(
        () => {
          setSelected(replayId);
          setPending(undefined);
        },
        replayId
          ? Promise.all([queryClient.query(replayQuery(replayId)), queryClient.query(editsQuery(replayId)).catch(() => undefined)])
          : Promise.resolve(),
        { instant },
      );
    },
    [queryClient],
  );

  useEffect(() => {
    const onPop = () => {
      const route = suiteRunOf(location.pathname);
      if (route?.suiteId !== id) return;
      if (comparing) setSelected(route.replayId);
      else switchTo(route.replayId);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [comparing, id, switchTo]);

  const select = useCallback(
    (replayId: string | undefined, instant = false) => {
      if (!replayId || replayId === target) return;
      if (comparing) {
        setPageUrl(`${replayInSuiteHref(replayId, id)}${location.search}`, { push: true });
        setSelected(replayId);
        return;
      }
      setPageUrl(replayInSuiteHref(replayId, id), { push: true });
      switchTo(replayId, instant);
    },
    [comparing, id, switchTo, target],
  );

  // J / Shift+J anywhere in the workspace (K stays play/pause).
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const action = shortcutFor(event, event.target instanceof HTMLElement ? event.target : null);
      if (action !== 'next-run' && action !== 'previous-run') return;
      // why: the comparison moves its own focus with these keys.
      if (comparing || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      // A held key steps run by run without queueing a transition per step.
      select(neighbourReplayId(runs, target, action === 'next-run' ? 1 : -1, detailed), event.repeat);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [comparing, detailed, runs, select, target]);

  // The neighbouring runs load at low priority once the suite is up, so J / Shift+J and a click on the next
  // or previous run swap in place without a skeleton (bundles are capped, so only the two neighbours).
  useEffect(() => {
    if (!suite || !selected) return;
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 800));
    const handle = idle(() => {
      for (const step of [1, -1] as const) {
        const neighbour = neighbourReplayId(runs, selected, step, detailed);
        if (neighbour && neighbour !== selected) void prefetchReplay(queryClient, neighbour);
      }
    });
    return () => (window.cancelIdleCallback ?? window.clearTimeout)(handle);
  }, [detailed, queryClient, runs, selected, suite]);

  useEffect(() => {
    if (suite) document.title = `${suite.title} · ${productName()}`;
  }, [suite]);

  const switchRail = () => {
    if (workspace.current) panelMotion(workspace.current, 'columns');
    setRailPreference(!collapsed);
  };

  // Memoised props for the viewer's (memo) header, so inspector tab switches do not re-render it.
  const backHref = useMemo(() => indexReturnHref(), []);
  const suiteDetails = useMemo<SuiteDetails | undefined>(() => {
    if (!suite) return undefined;
    const subject = subjectLink(suite);
    const runSummary = runs.find((item) => item.replayId === selected)?.summary;
    return { title: suite.title, href: suiteHref(id), ...(subject ? { subject } : {}), ...(runSummary ? { runSummary } : {}) };
  }, [id, suite, runs, selected]);
  const keep = useKeepSuite(id);
  // Phones: no sidebar; the title is the run switcher (tap "Run 1 of 2 · label ⌄").
  const runMenu = useMemo(
    () => (suite && narrow ? <RunMenuItems runs={runs} detailed={detailed} selected={target} onSelect={select} /> : undefined),
    [detailed, narrow, runs, select, target, suite],
  );

  const run = runs.find((item) => item.replayId === selected);
  const runTitle = run?.label;
  // The run title shown before this one: switching runs remounts the viewer, and its title morphs from this.
  const shownTitle = bundle && bundle.meta.id === selected ? runTitle : undefined;
  const [titles, setTitles] = useState<{ current?: string; previous?: string }>({});
  if (shownTitle && shownTitle !== titles.current)
    setTitles({ current: shownTitle, ...(titles.current ? { previous: titles.current } : {}) });
  // Phones hide the runs sidebar, so the run's place in the suite rides along as a muted prefix.
  const playableRuns = runs.flatMap((item) => playableReplayId(item, detailed) ?? []);
  const runIndex = playableRuns.indexOf(selected ?? '');
  const runPrefix = narrow && runIndex >= 0 ? `Run ${runIndex + 1} of ${playableRuns.length}` : undefined;
  const tone = run ? statusTone(run, detailed) : undefined;
  const runStatus = tone ? <RunStatusChip tone={tone} /> : undefined;

  if (signingIn) return <ViewerSkeleton suite label="Signing in" />;
  if (authFailure || (error && !suite)) {
    const message = authFailure?.message ?? error;
    return <FailureShell thing="review suite" failure={authFailure ?? message} details={`${message} · ${id}`} />;
  }

  // Until the suite itself has loaded, the whole workspace is a skeleton (sidebar included), so the sidebar never
  // pops in beside an already-drawn run.
  if (!suite) return <ViewerSkeleton suite label="Loading review suite" />;

  return (
    <div
      ref={workspace}
      className="suite-workspace"
      data-rail={collapsed || undefined}
      data-narrow={narrow || undefined}
      style={!narrow && !collapsed ? { gridTemplateColumns: `${sidebarWidth}px 0 minmax(0, 1fr)` } : undefined}
    >
      {/* First in the page, ahead of the runs sidebar, so one Tab reaches it. */}
      <a className="skip-link" href="#replay-player">
        Skip to replay
      </a>
      {!narrow ? (
        <SuiteSidebar
          suite={suite}
          runs={runs}
          recorded={playable}
          detailed={detailed}
          selected={target}
          collapsed={collapsed}
          onSelect={select}
          onSwitch={switchRail}
          keep={keep}
          performanceFocused={performanceFocused}
        />
      ) : null}
      {!narrow && !collapsed ? (
        <Splitter
          orientation="vertical"
          side="start"
          value={sidebarWidth}
          min={240}
          max={400}
          defaultValue={256}
          onChange={setSidebarWidth}
          onPreview={setSidebarWidth}
          storageKey="suite-sidebar-width"
          label="Resize runs sidebar"
          className="suite-sidebar-split"
        />
      ) : null}

      <div className="suite-viewer">
        {comparing && selected ? (
          <Suspense fallback={<ViewerSkeleton label="Loading runs" comparing={defaults.layout === 'grid' ? playable.length : 0} />}>
            <SuiteCompare
              // why: the runs sidebar (desktop) and the title run menu (phone) already switch runs; colour frames mark
              // the focused tile. The CompareSummary strip belongs on standalone Compare — on a phone with many runs
              // it wraps into an unreadable pile of clocks and deltas above the player.
              hideCompareSummary
              runs={playable}
              fallback={defaults.layout}
              focus={selected}
              onFocus={select}
              page={{
                ...(runTitle ? { title: runTitle } : {}),
                ...(runStatus ? { status: runStatus } : {}),
                ...(suiteDetails ? { suite: suiteDetails } : {}),
                ...(runMenu ? { titleMenu: runMenu } : {}),
                backHref,
                skipLink: false,
                initialTab: tab,
                onTabChange: setTab,
                suiteProfile: suite?.profile,
              }}
            />
          </Suspense>
        ) : bundle && bundle.meta.id === selected && editsSettled ? (
          <EditedViewer
            key={bundle.meta.id}
            bundle={bundle}
            edits={edits.data}
            {...(runTitle ? { title: runTitle } : {})}
            {...(runPrefix ? { prefix: runPrefix } : {})}
            {...(runStatus ? { status: runStatus } : {})}
            {...(suiteDetails ? { suite: suiteDetails } : {})}
            {...(runMenu ? { titleMenu: runMenu } : {})}
            {...(titles.previous && titles.previous !== runTitle ? { titleFrom: titles.previous } : {})}
            backHref={backHref}
            skipLink={false}
            initialTab={tab}
            onTabChange={setTab}
            suiteProfile={suite?.profile}
          />
        ) : bundleError ? (
          <main className="app-shell">
            <Topbar
              title={runTitle ?? suite?.title ?? 'Review suite'}
              {...(runPrefix ? { prefix: runPrefix } : {})}
              backHref={backHref}
              compact={narrow}
              {...(runMenu ? { titleMenu: runMenu } : {})}
            />
            <RunUnavailable message={bundleError} />
          </main>
        ) : !selected && playable.length === 0 ? (
          <main className="app-shell">
            <Topbar title={suite.title} backHref={backHref} compact={narrow} />
            {runs.some((item) => isExpired(item, detailed)) ? (
              <SuiteExpired replayIds={runs.flatMap((item) => (item.replayId ? [item.replayId] : []))} />
            ) : (
              <StateView kind="empty" title="No recordings yet" cause="Runs appear here as the review uploads them." />
            )}
          </main>
        ) : (
          <ViewerSkeleton label="Loading run" />
        )}
      </div>
    </div>
  );
}

function SuiteSidebar({
  suite,
  runs,
  recorded,
  detailed,
  selected,
  collapsed,
  onSelect,
  onSwitch,
  keep,
  performanceFocused,
}: {
  suite: SuiteWithRuns;
  runs: WorkspaceRun[];
  recorded: RecordedRun[];
  detailed: boolean;
  selected: string | undefined;
  collapsed: boolean;
  onSelect: (replayId: string | undefined) => void;
  onSwitch: () => void;
  keep: ReturnType<typeof useKeepSuite>;
  performanceFocused: boolean;
}) {
  const RailIcon = collapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon;
  const overall = suiteOverallStatus(runs);
  const duration = runs.reduce((total, run) => total + (run.duration ?? 0), 0);
  const list = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const subject = subjectLink(suite);
  const selectedIndex = runs.findIndex((run) => playableReplayId(run, detailed) === selected);
  const colours = new Map(recorded.map((run) => [run.replayId, run.colour]));
  const names = shortNames(runs.map((run) => run.label));
  const marks = monograms(names);
  const { highlight, place } = useSlidingHighlight(list, { selector: '[aria-current="page"]', index: selectedIndex });
  // After the current run changes (or the rail collapses), slide the one highlight to it.
  useLayoutEffect(() => {
    place();
    // `place` reads refs only.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [selectedIndex, collapsed]);

  // The neighbours J / Shift+J reach, so their tooltips can show the key.
  const nextRunId = neighbourReplayId(runs, selected, 1, detailed);
  const previousRunId = neighbourReplayId(runs, selected, -1, detailed);
  // ↑/↓ and J/K move between runs while the run list is active.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === 'ArrowDown' || event.key === 'j' ? 1 : event.key === 'ArrowUp' || event.key === 'k' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    const next = neighbourReplayId(runs, selected, step, detailed);
    onSelect(next);
    if (next) requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-replay-id="${CSS.escape(next)}"]`)?.focus());
  };

  return (
    <aside className="suite-sidebar" aria-label="Review suite">
      <div className="suite-sidebar-head">
        {collapsed ? null : (
          <div className="suite-sidebar-title">
            <h2 title={suite.title}>{displayTitle({ title: suite.title, sources: subject && [subject] })}</h2>
          </div>
        )}
        <IconButton
          label={collapsed ? 'Expand runs sidebar' : 'Collapse runs sidebar'}
          tooltipSide="right"
          size="icon-sm"
          className="suite-rail-switch"
          onClick={onSwitch}
        >
          <RailIcon aria-hidden="true" />
        </IconButton>
        {collapsed ? null : (
          <>
            <p className="suite-sidebar-overview">
              <span className="suite-sidebar-status">
                <span className={`status-dot tone-${overall.toLowerCase()}`} aria-hidden="true" />
                {overall}
              </span>
              <span className="suite-sidebar-count">{plural(runs.length, 'run')}</span>
              <span className="suite-sidebar-duration" title="Total recording duration">
                {formatClock(duration)} total
              </span>
            </p>
            {keep.kept ? (
              <p className="suite-sidebar-meta suite-kept" data-testid="suite-kept">
                <PinIcon aria-hidden="true" />
                Kept by {keep.retention?.kept?.by ?? 'someone'}
              </p>
            ) : null}
            {suite.summary ? (
              <details className="suite-sidebar-summary" open data-testid="suite-summary">
                <summary>Review summary</summary>
                <SummaryText summary={suite.summary} />
              </details>
            ) : null}
          </>
        )}
      </div>
      <div ref={list} className="suite-run-list" role="list" aria-label="Runs">
        <HoverGlide container={list} itemSelector=".suite-run-item" />
        <div ref={highlight} className="sliding-highlight" aria-hidden="true" />
        {runs.map((run, index) => {
          const errors = runErrors(run);
          const playable = playableReplayId(run, detailed);
          const expired = isExpired(run, detailed);
          const tone = statusTone(run, detailed);
          const current = playable !== undefined && playable === selected;
          const colour = playable ? colours.get(playable) : undefined;
          const content = collapsed ? (
            <span className="run-monogram" aria-hidden="true">
              {marks[index]}
              <span className={`status-dot tone-${tone}`} />
            </span>
          ) : (
            <RunCopy
              run={run}
              name={names[index] ?? run.label}
              status={playable ? tone : expired ? 'Expired' : 'No recording'}
              tone={tone}
              metrics={runRowMetrics(run, performanceFocused)}
            />
          );
          const label = `Run ${sequenceLabel(run)}: ${run.label}, ${tone}${errors ? `, ${plural(errors, 'error')}` : ''}${playable ? '' : expired ? ', recording expired' : ', no recording'}`;
          return (
            <div role="listitem" key={run.id}>
              {playable ? (
                <Hint
                  label={run.label}
                  disabled={!collapsed}
                  side="right"
                  {...(playable && playable === nextRunId
                    ? { shortcut: shortcutLabel('next-run') }
                    : playable && playable === previousRunId
                      ? { shortcut: shortcutLabel('previous-run') }
                      : {})}
                >
                  <button
                    type="button"
                    className="suite-run-item"
                    data-replay-id={playable}
                    style={cssVars({ '--run-colour': `var(--tile-${colour}, var(--text-tertiary))` })}
                    aria-current={current ? 'page' : undefined}
                    aria-label={label}
                    tabIndex={current || (!selected && run === runs[0]) ? 0 : -1}
                    onPointerEnter={() => void prefetchReplay(queryClient, playable)}
                    onFocus={() => void prefetchReplay(queryClient, playable)}
                    onClick={() => onSelect(playable)}
                    onKeyDown={onKeyDown}
                  >
                    {content}
                  </button>
                </Hint>
              ) : (
                <div className="suite-run-item" aria-disabled="true" title={label}>
                  {content}
                  {collapsed ? <span className="visually-hidden">{label}</span> : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/** One expanded sidebar row: the run's colour swatch, name, duration, status and error count. */
function RunCopy({
  run,
  name,
  status,
  tone,
  metrics,
}: {
  run: WorkspaceRun;
  name: string;
  status: string;
  tone: string;
  metrics: RunMetric[] | undefined;
}) {
  const errors = runErrors(run);
  return (
    <>
      <span className="run-swatch" aria-hidden="true" />
      <span className="run-copy">
        <span className="run-label" title={run.label}>
          {name}
        </span>
        {run.duration !== undefined ? <span className="run-duration">{formatClock(run.duration)}</span> : null}
        <span className="run-meta">
          <span className={`run-status tone-${tone}`}>{status}</span>
          {errors > 0 ? <span className="run-errors">{plural(errors, 'error')}</span> : null}
        </span>
        {metrics ? <RunPerf metrics={metrics} /> : null}
      </span>
    </>
  );
}

/** A performance-focused suite's comparison row: what the run recorded, and a plain note for what it did not. */
function RunPerf({ metrics }: { metrics: RunMetric[] }) {
  const noFps = metrics.length > 0 && !metrics.some((metric) => metric.id === 'fps');
  return (
    <span className="run-perf" data-testid="run-perf">
      {metrics.map((metric) => (
        <span key={metric.id} data-verdict={metric.verdict}>
          {metric.label} <strong>{metric.value}</strong>
        </span>
      ))}
      {metrics.length === 0 ? <span>No performance data</span> : null}
      {noFps ? <span>FPS not recorded</span> : null}
    </span>
  );
}

const TONE_LABELS: Record<string, string> = {
  failed: 'Failed',
  passed: 'Passed',
  running: 'Running',
  partial: 'Partial',
  waiting: 'No recording',
};

const STATUS_TONES: Record<string, StatusTone> = { passed: 'success', partial: 'warning', failed: 'danger', running: 'accent' };

/** The topbar's run result: a dot and a word, never a bordered pill (the row's one strong mark); failures read first. */
function RunStatusChip({ tone }: { tone: string }) {
  return (
    <StatusLabel tone={STATUS_TONES[tone] ?? 'neutral'} strong={tone === 'failed' || tone === 'partial'} data-testid="run-status">
      {TONE_LABELS[tone] ?? tone}
    </StatusLabel>
  );
}

/** Phones: the run picker, as a labelled radio group in the menu the topbar title opens. */
function RunMenuItems({
  runs,
  detailed,
  selected,
  onSelect,
}: {
  runs: WorkspaceRun[];
  detailed: boolean;
  selected: string | undefined;
  onSelect: (replayId: string | undefined) => void;
}) {
  const playable = runs.filter((run) => playableReplayId(run, detailed));
  const index = playable.findIndex((run) => run.replayId === selected);
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>
        Run {index + 1} of {playable.length}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup value={selected ?? ''} onValueChange={(value) => onSelect(String(value))}>
        {runs.map((run) => (
          <DropdownMenuRadioItem
            key={run.id}
            value={playableReplayId(run, detailed) ?? `missing-${run.id}`}
            disabled={!playableReplayId(run, detailed)}
            closeOnClick
            className="run-picker-item"
          >
            <span className="run-seq">{sequenceLabel(run)}</span>
            <span className="run-picker-label">{run.label}</span>
            {isExpired(run, detailed) ? <span className="run-picker-expired">Expired</span> : null}
            <span className={`status-dot tone-${statusTone(run, detailed)}`} aria-hidden="true" />
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  );
}

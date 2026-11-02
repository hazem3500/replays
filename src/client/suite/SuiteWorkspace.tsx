import { SignInError, SignInLink } from '../sign-in.tsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGridIcon } from 'lucide-react';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import { EmptyState } from '@/components/ui/empty-state.tsx';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu.tsx';

import { LayoutSwitch } from '../comparison/meeting/LayoutSwitch.tsx';
import type { MeetingSearch } from '../comparison/meeting/url.ts';
import { layoutOf, type MeetingLayout, withLayout } from '../comparison/meeting/view-state.ts';
import { productName } from '../config.ts';
import { useMeetingClock } from '../hooks/use-clock.ts';
import { useLatest } from '../hooks/use-latest.ts';
import { useWindowKeydown } from '../hooks/use-window-keydown.ts';
import { prefetchReplay, replayQuery, suiteQuery } from '../queries.ts';
import { swapInPlace } from '../navigation.ts';
import { indexHref, indexReturnHref, parseRoute, replayInSuiteHref, suiteHref } from '../route.ts';
import { shortcutFor } from '../shortcuts.ts';
import { MOBILE_QUERY, useMediaQuery } from '../media.ts';
import { Topbar } from '../Topbar.tsx';
import { EditedViewer } from '../Viewer.tsx';
import { editsQuery } from '../edits.ts';
import { ViewerSkeleton } from '../ViewerSkeleton.tsx';
import { useKeepSuite } from '../viewer/keep.ts';
import type { SuiteDetails } from '../viewer/ReplayInfo.tsx';
import type { InspectorTab } from '../viewer/context.ts';
import { KeepSuiteItem, RunMenuItems, RunStatusChip } from './RunMenu.tsx';
import { statusTone, subjectLink, SUITE_STRINGS, workspaceRuns } from './run-rows.ts';
import { initialRunReplayId, isExpired, neighbourReplayId, playableReplayId } from './runs.ts';
import { SuiteSidebar } from './SuiteSidebar.tsx';
import { crossfadeLayout } from './layout-transition.ts';
import { LazyMeetingRoom, loadMeetingRoom, meetingRoomLoaded } from './meeting-room-loader.ts';
import { parseSuiteView, pinRun, settleSuiteView, suiteViewHref, type SuiteView } from './suite-layout.ts';

const singlePlayer = () => document.querySelector('.suite-viewer .player-frame');

/**
 * The suite workspace: a runs sidebar (collapsible to a slim rail, replaced by
 * a run switcher at ≤ 720 px) next to the full viewer for the selected run.
 * Switching runs swaps the replay in place and pushes history, so back and
 * forward move between runs. Grid and spotlight layouts show every run at
 * once on one clock (the meeting view `/compare` uses), in the same URL.
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
  const [view, setView] = useState(() => parseSuiteView(location.search));
  const clock = useMeetingClock(view.meeting.t ? view.meeting.t * 1000 : undefined);
  const { data: bundle, error: bundleFailure } = useQuery({ ...replayQuery(selected ?? ''), enabled: Boolean(selected) });
  const bundleError = bundleFailure ? bundleFailure.message : '';
  // Runs show their saved edits too; a failed load shows the run as recorded.
  const edits = useQuery({ ...editsQuery(selected ?? ''), enabled: Boolean(selected) });
  const editsSettled = edits.data !== undefined || edits.isError;
  // An observed auth failure must win over cached suite, bundle or edit data.
  const authFailure = [suiteFailure, bundleFailure, edits.error].find((candidate) => candidate instanceof SignInError);
  const [tab, setTab] = useState<InspectorTab>('console');
  // A suite always opens with the runs sidebar expanded; collapsing it only lasts for this visit.
  const [railPreference, setRailPreference] = useState<boolean | undefined>(undefined);
  const narrow = useMediaQuery(MOBILE_QUERY);
  // Open by default at every desktop width; only an explicit choice collapses it (phones use the run menu).
  const collapsed = railPreference ?? false;

  // The landing run goes into the URL without adding a history entry, and is pinned so a background
  // refresh of the suite (a run that failed meanwhile) cannot move the viewer to another run.
  useEffect(() => {
    if (chosen || !landing) return;
    history.replaceState(history.state, '', `${replayInSuiteHref(landing, id)}${location.search}${location.hash}`);
    // oxlint-disable-next-line react/set-state-in-effect -- pins a value already on screen; no visible re-render
    setSelected(landing);
  }, [chosen, id, landing]);

  const runs = useMemo(() => workspaceRuns(suite), [suite]);
  const detailed = Boolean(suite?.runDetails);

  // The run being switched to: the sidebar's selection moves at once, the viewer once its data is in (or after a
  // short wait), as one calm in-place transition (navigation.ts swapInPlace).
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
          ? Promise.all([
              queryClient.fetchQuery(replayQuery(replayId)),
              queryClient.fetchQuery(editsQuery(replayId)).catch(() => undefined),
            ])
          : Promise.resolve(),
        { instant },
      );
    },
    [queryClient],
  );

  useEffect(() => {
    const onPop = () => {
      const route = parseRoute(location.pathname, location.search);
      if (route.kind !== 'suite' || route.id !== id) return;
      setView(parseSuiteView(location.search));
      switchTo(route.replayId);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [id, switchTo]);

  const select = useCallback(
    (replayId: string | undefined, instant = false) => {
      if (!replayId || replayId === target) return;
      history.pushState(null, '', replayInSuiteHref(replayId, id));
      switchTo(replayId, instant);
    },
    [id, switchTo, target],
  );

  // why: a suite compares its own runs in place: the meeting view's tiles are its playable runs.
  const roomRuns = { ids: [] as string[], labels: {} as Record<string, string> };
  for (const item of runs) {
    const replayId = playableReplayId(item, detailed);
    if (!replayId) continue;
    roomRuns.ids.push(replayId);
    roomRuns.labels[replayId] = item.label;
  }
  const shown = settleSuiteView(view, roomRuns.ids, selected);
  const layout = shown.layout;

  const writeView = (next: SuiteView, run: string | undefined, singleTime?: number) => {
    const path = run ? replayInSuiteHref(run, id) : location.pathname;
    history.replaceState(history.state, '', `${suiteViewHref(path, next, location.search, singleTime)}${location.hash}`);
  };
  // why: in the spotlight the pinned run is the selected one, so Single opens it.
  const onMeetingChange = (meeting: MeetingSearch) => {
    const next = { layout: layoutOf(meeting), meeting };
    const run = meeting.pin ?? selected;
    writeView(next, run);
    setView(next);
    if (run && run !== chosen) setSelected(run);
  };
  const changeLayout = (next: MeetingLayout) => {
    if (next === layout) return;
    if (next !== 'single' && layout !== 'single') {
      onMeetingChange(withLayout(shown.meeting, next, shown.meeting.ids ?? roomRuns.ids, selected));
      return;
    }
    const run = (layout === 'spotlight' ? shown.meeting.pin : undefined) ?? selected;
    const goal: SuiteView =
      next === 'single'
        ? { layout: next, meeting: shown.meeting }
        : { layout: next, meeting: withLayout(shown.meeting, next, roomRuns.ids, run) };
    const singleTime = next === 'single' && run && clock.getTime() > 0 ? clock.localTime(run) : undefined;
    if (next === 'single') clock.pause();
    const tile = () => (run ? document.querySelector(`.mt-tile[data-tile-id="${CSS.escape(run)}"] .mt-player`) : null);
    const apply = () =>
      crossfadeLayout(
        () => {
          writeView(goal, run, singleTime);
          setView(goal);
          if (run && run !== chosen) setSelected(run);
        },
        next === 'single' ? tile : singlePlayer,
        next === 'single' ? singlePlayer : tile,
      );
    if (next !== 'single' && !meetingRoomLoaded()) void loadMeetingRoom().then(apply);
    else apply();
  };
  const latestChangeLayout = useLatest(changeLayout);

  // why: the sidebar, run menu and J move the single viewer between runs, pin a run in the spotlight, or bring
  // its tile into reach in the grid.
  const current = layout === 'spotlight' ? shown.meeting.pin : layout === 'grid' ? selected : target;
  const pick = (replayId: string | undefined, instant = false) => {
    if (layout === 'single') return select(replayId, instant);
    if (!replayId) return;
    if (layout === 'spotlight') return onMeetingChange(pinRun(shown.meeting, replayId));
    writeView(shown, replayId);
    setSelected(replayId);
    document.querySelector<HTMLElement>(`.mt-tile[data-tile-id="${CSS.escape(replayId)}"]`)?.focus();
  };

  // J / Shift+J anywhere in the workspace (K stays play/pause).
  useWindowKeydown((event) => {
    const action = shortcutFor(event, event.target instanceof HTMLElement ? event.target : null);
    if (action !== 'next-run' && action !== 'previous-run') return;
    if (document.querySelector('[role="dialog"]')) return;
    event.preventDefault();
    // A held key steps run by run without queueing a transition per step.
    pick(neighbourReplayId(runs, current, action === 'next-run' ? 1 : -1, detailed), event.repeat);
  });

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
    const next = !collapsed;
    setRailPreference(next);
  };

  // Memoised props for the viewer's (memo) header, so inspector tab switches do not re-render it.
  const backHref = useMemo(() => indexReturnHref(), []);
  const suiteDetails = useMemo<SuiteDetails | undefined>(() => {
    if (!suite) return undefined;
    const subject = subjectLink(suite);
    return { title: suite.title, href: suiteHref(id), ...(subject ? { subject } : {}) };
  }, [id, suite]);
  // Keep (no expiry) for the whole suite: a pin in the sidebar head, or a "More" item on phones (no sidebar).
  const keep = useKeepSuite(id);
  const comparable = roomRuns.ids.length >= 2;
  // why: phones have no sidebar, so "Show all runs" joins Keep in the single viewer's "More" menu.
  const keepMenu = useMemo(
    () =>
      narrow ? (
        <>
          {comparable ? (
            <DropdownMenuItem onClick={() => latestChangeLayout.current('grid')} data-testid="show-all-runs">
              <LayoutGridIcon aria-hidden="true" />
              {SUITE_STRINGS.showAll}
            </DropdownMenuItem>
          ) : null}
          <KeepSuiteItem kept={keep.kept} pending={keep.pending} onFlip={keep.flip} />
        </>
      ) : undefined,
    [comparable, keep.kept, keep.pending, keep.flip, latestChangeLayout, narrow],
  );
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
  const playableRuns = runs.filter((item) => playableReplayId(item, detailed));
  const runIndex = playableRuns.findIndex((item) => item.replayId === selected);
  const runPrefix = narrow && runIndex >= 0 ? `Run ${runIndex + 1} of ${playableRuns.length}` : undefined;
  // Memoised (by tone) so the viewer's memo header skips inspector tab switches.
  const tone = run ? statusTone(run, detailed) : undefined;
  const runStatus = useMemo(() => (tone ? <RunStatusChip tone={tone} /> : undefined), [tone]);

  if (authFailure || (error && !suite)) {
    return (
      <main className="state-shell">
        <a className="state-brand" href={indexHref()}>
          {productName()}
        </a>
        <EmptyState
          tone="error"
          title={authFailure?.message ?? error}
          body={SUITE_STRINGS.suiteFailedBody(id)}
          actions={[
            { id: 'retry', label: SUITE_STRINGS.retry, primary: true, onSelect: () => location.reload() },
            { id: 'back', label: SUITE_STRINGS.back, href: indexHref() },
          ]}
        />
        <SignInLink error={authFailure ?? suiteFailure} />
      </main>
    );
  }

  // Until the suite itself has loaded, the whole workspace is a skeleton (sidebar included), so the sidebar never
  // pops in beside an already-drawn run.
  if (!suite) return <ViewerSkeleton suite label="Loading review suite" />;

  return (
    <div className="suite-workspace" data-rail={collapsed || undefined} data-narrow={narrow || undefined}>
      {/* First in the page, ahead of the runs sidebar, so one Tab reaches it. */}
      <a className="skip-link" href="#replay-player">
        Skip to replay
      </a>
      {suite && !narrow ? (
        <SuiteSidebar
          suite={suite}
          runs={runs}
          detailed={detailed}
          selected={current}
          collapsed={collapsed}
          onSelect={pick}
          onSwitch={switchRail}
          keep={keep}
          {...(comparable
            ? {
                layoutSwitch: (
                  <LayoutSwitch
                    value={layout}
                    options={['single', 'grid', 'spotlight']}
                    onChange={changeLayout}
                    onIntent={() => void loadMeetingRoom()}
                    compact={collapsed}
                    vertical={collapsed}
                  />
                ),
              }
            : {})}
        />
      ) : null}
      <div className="suite-viewer">
        {layout !== 'single' ? (
          <Suspense fallback={<ViewerSkeleton label="Loading runs" />}>
            <LazyMeetingRoom
              suiteId={id}
              title={suite.title}
              runs={roomRuns}
              meeting={shown.meeting}
              onMeetingChange={onMeetingChange}
              clock={clock}
              narrow={narrow}
              onLayout={changeLayout}
              backHref={backHref}
              {...(narrow ? { menu: <KeepSuiteItem kept={keep.kept} pending={keep.pending} onFlip={keep.flip} /> } : {})}
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
            {...(keepMenu ? { menu: keepMenu } : {})}
            {...(titles.previous && titles.previous !== runTitle ? { titleFrom: titles.previous } : {})}
            backHref={backHref}
            skipLink={false}
            initialTab={tab}
            onTabChange={setTab}
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
            <EmptyState
              tone="error"
              title={SUITE_STRINGS.runFailed}
              body={bundleError === 'Replay not found' ? SUITE_STRINGS.runGone : bundleError}
            />
            <SignInLink error={bundleFailure} />
          </main>
        ) : suite && !selected && runs.every((item) => !playableReplayId(item, detailed)) ? (
          <main className="app-shell">
            <Topbar title={suite.title} backHref={backHref} compact={narrow} />
            {runs.some((item) => isExpired(item, detailed)) ? (
              <EmptyState icon="folder" title={SUITE_STRINGS.expiredTitle} body={SUITE_STRINGS.expiredBody()} />
            ) : (
              <EmptyState icon="inbox" title={SUITE_STRINGS.noRecordingsTitle} body={SUITE_STRINGS.noRecordingsBody} />
            )}
          </main>
        ) : (
          <ViewerSkeleton label="Loading run" />
        )}
      </div>
    </div>
  );
}

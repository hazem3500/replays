import { FastForwardIcon, PinIcon, PinOffIcon } from 'lucide-react';
import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { AnimatedText } from '@/components/animated-text.tsx';
import { type CSSProperties, memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { formatClock, type ReplayBundle } from '../shared/replay.ts';
import { copyText } from './clipboard.ts';
import { notify as showToast } from './toast.ts';
import { collectErrors, nextError, previousError, type ReplayError } from './issues.ts';
import { parsePermalink, stepPermalink, timePermalink } from './permalink.ts';
import { PlayerContext, ReplayController, SPEEDS, usePlayer, usePlayerState } from './player.ts';
import { shortcutFor, shortcutLabel } from './shortcuts.ts';
import { nextStepIndex, previousStepIndex } from './timeline.ts';
import { type InspectorTab, useViewer, type ViewerActions, ViewerContext } from './viewer/context.ts';
import { DownloadVideoButton, usePhoneDownload } from './viewer/DownloadVideo.tsx';
import { useActiveStep } from './viewer/active-step.ts';
// The caption's look is shared with exported videos (render page); the viewer must load it itself.
import './step-caption.css';
import { clampInspectorHeight, initialInspectorHeight, Inspector, InspectorResizer, type MobilePanel } from './viewer/Inspector.tsx';
import { MOBILE_QUERY, useMediaQuery } from './media.ts';
import { ShortcutSheet } from './viewer/ShortcutSheet.tsx';
import { savedStepsWidth, StepRail, StepsResizer } from './viewer/StepRail.tsx';
import { activeStepIndex, FullscreenButton, PlayerStage, Transport } from './viewer/Transport.tsx';

import { Topbar, type TopbarMenuItem } from './Topbar.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu.tsx';
import { SourceChip, topbarSource } from './viewer/SourceChip.tsx';
import { IconButton } from '@/components/icon-button.tsx';
import { readStorage, writeStorage } from './storage.ts';
import { ReplayInfoButton, type SuiteDetails } from './viewer/ReplayInfo.tsx';
import { useKeep } from './viewer/keep.ts';

const INSPECTOR_COLLAPSED_KEY = 'replays-inspector-collapsed';
const CAPTIONS_KEY = 'replays-captions';
/** A folded panel keeps just its tab row (36 px) and the hairline above it. */
const INSPECTOR_TABS_HEIGHT = 37;
/** An expanded request grows a shorter desktop panel to this share of the window… */
const REQUEST_PANEL_SHARE = 0.45;
/** …but never so far that the player gets less than this share of the viewer's height. */
const MIN_PLAYER_SHARE = 0.4;

export function Viewer({
  bundle,
  title,
  prefix,
  status,
  suite,
  initialTab = 'console',
  onTabChange,
  menu,
  titleMenu,
  titleFrom,
  backHref,
  skipLink = true,
}: {
  bundle: ReplayBundle;
  /** Overrides the recording title in the topbar (the suite workspace shows the run label). */
  title?: string;
  /** Muted text before the title, e.g. "Run 2 of 2" on phones where the runs sidebar is hidden. */
  prefix?: string;
  /** The topbar's status chip; defaults to the error count (or "Imported"). The suite passes the run status. */
  status?: ReactNode;
  /** The review suite this run belongs to, for the details popover. */
  suite?: SuiteDetails;
  initialTab?: InspectorTab;
  onTabChange?: (tab: InspectorTab) => void;
  /** Extra items for the topbar's "More" menu. */
  menu?: ReactNode;
  /** Phones: the title opens this menu (the suite workspace's run switcher). */
  titleMenu?: ReactNode;
  /** The title this page replaces (the previous suite run's): the top bar's title morphs from it. */
  titleFrom?: string | undefined;
  /** Where the topbar's back arrow goes (defaults to the index with its last filters). */
  backHref?: string;
  /** False when the page already starts with its own skip link (the suite workspace, whose runs sidebar comes first). */
  skipLink?: boolean;
}) {
  const errors = useMemo(() => collectErrors(bundle), [bundle]);
  const opened = useMemo(() => {
    const controller = new ReplayController(bundle);
    // Permalinks open paused at their moment.
    const target = parsePermalink(location.search, location.hash, bundle.steps.length);
    const at = target.step === undefined ? target.time : bundle.steps[target.step]?.at;
    if (at !== undefined) controller.seek(at);
    const step = target.step === undefined ? undefined : { index: target.step, time: controller.getTime() };
    return { controller, step };
  }, [bundle]);
  const player = opened.controller;
  /** The step `[`/`]` last landed on, while the playhead has not moved since (see nextStepIndex). */
  const stepCursor = useRef(opened.step);
  useEffect(() => {
    stepCursor.current = opened.step;
  }, [opened]);
  const playerRegion = useRef<HTMLElement>(null);
  const shell = useRef<HTMLElement>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutsOpenRef = useRef(false);
  useEffect(() => {
    shortcutsOpenRef.current = shortcutsOpen;
  }, [shortcutsOpen]);
  const [inspectorHeight, setInspectorHeight] = useState(initialInspectorHeight);
  const [speedHud, setSpeedHud] = useState<{ speed: number; id: number }>();
  const [stepsWidth, setStepsWidth] = useState(savedStepsWidth);
  const workspace = useRef<HTMLDivElement>(null);
  const [tab, setTabState] = useState<InspectorTab>(initialTab);
  // Step captions on the player: off until someone turns them on (remembered).
  const [captions, setCaptionsState] = useState(() => readStorage(CAPTIONS_KEY) === '1');
  const switchCaptions = useCallback(() => {
    setCaptionsState((current) => {
      writeStorage(CAPTIONS_KEY, current ? '0' : '1');
      return !current;
    });
  }, []);
  // The bottom panel folds to its tab row (desktop). Remembered; open when nothing is stored.
  const [collapsed, setCollapsedState] = useState(() => readStorage(INSPECTOR_COLLAPSED_KEY) === '1');
  /** `persist: false` is a transient change for one action (a shortcut that needs the panel), not a preference. */
  const setCollapsed = useCallback((next: boolean, persist = true) => {
    if (persist) writeStorage(INSPECTOR_COLLAPSED_KEY, next ? '1' : '0');
    // Animate the fold only for this change (never while the resizer drags).
    const element = shell.current;
    if (element && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (element.dataset.mobile !== undefined) foldPhonePanel(element, next);
      else {
        element.dataset.inspectorAnimating = '';
        window.setTimeout(() => delete element.dataset.inspectorAnimating, 260);
      }
    }
    setCollapsedState(next);
  }, []);
  const collapsedRef = useRef(collapsed);
  useEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);
  // Phones: one tabbed panel under the player; Steps is its first tab and opens by default.
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [stepsSelected, setStepsSelected] = useState(true);
  const setTab = useCallback(
    (next: InspectorTab) => {
      setTabState(next);
      setStepsSelected(false);
      onTabChange?.(next);
    },
    [onTabChange],
  );
  const mobilePanel = useMemo<MobilePanel | undefined>(
    () =>
      mobile
        ? {
            stepsSelected,
            onSelectSteps: () => setStepsSelected(true),
          }
        : undefined,
    [mobile, stepsSelected],
  );
  const [expandedRequest, setExpandedRequest] = useState<string>();
  // An expanded request needs room: a short desktop panel grows to 45% of the window while it is open (not
  // persisted) and goes back to the person's height when it closes or the tab changes, unless they resized it
  // meanwhile. Never shrinks a taller panel. Phones skip it (their panel already takes the rest of the screen).
  const grown = useRef<{ from: number; to: number } | undefined>(undefined);
  const inspectorHeightRef = useRef(inspectorHeight);
  useEffect(() => {
    inspectorHeightRef.current = inspectorHeight;
  }, [inspectorHeight]);
  const roomForRequest = Boolean(expandedRequest) && tab === 'network' && !mobile && !collapsed;
  useEffect(() => {
    const element = shell.current;
    const animate = () => {
      if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      element.dataset.inspectorAnimating = '';
      window.setTimeout(() => delete element.dataset.inspectorAnimating, 260);
    };
    if (roomForRequest) {
      // The player keeps at least MIN_PLAYER_SHARE of the viewer: the panel takes what is left above that.
      const shellHeight = element?.clientHeight ?? window.innerHeight;
      const chrome =
        (element?.querySelector<HTMLElement>('.app-topbar')?.offsetHeight ?? 0) +
        (element?.querySelector<HTMLElement>('.transport')?.offsetHeight ?? 0);
      const room = Math.round(shellHeight - chrome - shellHeight * MIN_PLAYER_SHARE);
      const target = clampInspectorHeight(Math.min(Math.round(window.innerHeight * REQUEST_PANEL_SHARE), room));
      if (grown.current || inspectorHeightRef.current >= target) return;
      grown.current = { from: inspectorHeightRef.current, to: target };
      animate();
      setInspectorHeight(target);
    } else if (grown.current) {
      const { from, to } = grown.current;
      grown.current = undefined;
      if (inspectorHeightRef.current !== to) return;
      animate();
      setInspectorHeight(from);
    }
  }, [roomForRequest]);

  const notify = useCallback((message: string) => showToast(message), []);

  const actions = useMemo<ViewerActions>(() => {
    // Shortcuts and jumps that land in the panel unfold it first, transiently. Playback, seeks and steps never do.
    const showPanel = () => {
      if (collapsedRef.current) setCollapsed(false, false);
    };
    const jumpToError = (error: ReplayError) => {
      showPanel();
      player.seek(error.at);
      setTab(error.kind);
      if (error.requestId) {
        const id = error.requestId;
        setExpandedRequest(id);
        requestAnimationFrame(() => document.querySelector(`[data-request-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }));
      }
    };
    const goToStep = (index: number) => {
      const step = bundle.steps[index];
      if (!step) return;
      player.seek(step.at);
      stepCursor.current = { index, time: player.getTime() };
      history.replaceState(history.state, '', stepPermalink(location.href, index));
    };
    const currentStep = () => (stepCursor.current?.time === player.getTime() ? stepCursor.current.index : undefined);
    return {
      steps: bundle.steps,
      errors,
      setTab,
      setExpandedRequest,
      goToStep,
      goToNextStep: () => {
        const index = nextStepIndex(bundle.steps, player.getTime(), currentStep());
        if (index >= 0) goToStep(index);
      },
      goToPreviousStep: () => {
        const index = previousStepIndex(bundle.steps, player.getTime(), currentStep());
        if (index >= 0) goToStep(index);
      },
      jumpToError,
      goToNextError: () => {
        const error = nextError(errors, player.getTime());
        if (error) jumpToError(error);
        else notify(errors.length ? 'No later errors' : 'No errors in this replay');
      },
      goToPreviousError: () => {
        const error = previousError(errors, player.getTime());
        if (error) jumpToError(error);
        else notify(errors.length ? 'No earlier errors' : 'No errors in this replay');
      },
      copyLink: () => {
        const url = timePermalink(location.href, player.getTime());
        history.replaceState(history.state, '', url);
        void copyText(url).then((copied) => notify(copied ? `Link to ${formatClock(player.getTime())} copied` : 'Could not copy the link'));
      },
      switchFullscreen: () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void playerRegion.current?.requestFullscreen?.();
      },
      captions,
      switchCaptions,
      openShortcuts: () => {
        setShortcutsOpen(true);
      },
      notify,
    };
  }, [bundle.steps, captions, errors, notify, player, setCollapsed, setTab, switchCaptions]);

  // Keep (no expiry): a "More" item on every screen; uploads only (committed samples never expire).
  const keep = useKeep(bundle.meta.id);
  const keepItem = useMemo<TopbarMenuItem | undefined>(
    () =>
      keep.available
        ? {
            label: keep.kept ? 'Kept' : 'Keep',
            icon: keep.kept ? <PinOffIcon aria-hidden="true" /> : <PinIcon aria-hidden="true" />,
            onSelect: keep.flip,
            ...(keep.kept ? { detail: 'Release' } : {}),
            disabled: keep.pending,
            testId: 'keep-replay',
          }
        : undefined,
    [keep.available, keep.kept, keep.pending, keep.flip],
  );
  // Memoised so the (memo) header does not re-render on inspector tab switches.
  const headerMenuItems = useMemo<TopbarMenuItem[]>(
    () => [
      ...(keepItem ? [keepItem] : []),
      // Useless on phones: no keyboard.
      ...(mobile
        ? []
        : [
            {
              label: 'Keyboard shortcuts',
              icon: <AnimatedIcon name="keyboard" />,
              onSelect: actions.openShortcuts,
              shortcut: shortcutLabel('shortcuts'),
              ariaKeyshortcuts: 'Shift+?',
            },
          ]),
    ],
    [actions.openShortcuts, keepItem, mobile],
  );
  // The run's own first source wins; a run opened in a suite without one shows the suite's subject, so every run
  // of a review carries the same chip.
  const source = useMemo(() => topbarSource(bundle.context?.sources, suite?.subject), [bundle.context?.sources, suite?.subject]);
  const inspectorCollapse = useMemo(() => ({ collapsed, onCollapsedChange: setCollapsed }), [collapsed, setCollapsed]);
  const headerStatus = useMemo(
    () =>
      status || source ? (
        <>
          {status}
          {source ? <SourceChip source={source} /> : null}
        </>
      ) : undefined,
    [source, status],
  );

  // Phones: toasts rise from just above the transport (over the player's bottom edge), so they never cover the
  // playback controls or the panel's tabs, whether the panel is open, folded or folding.
  useEffect(() => {
    const element = shell.current;
    const transport = element?.querySelector<HTMLElement>('.transport');
    const workspaceElement = workspace.current;
    if (!mobile || !element || !transport || !workspaceElement) return;
    const root = document.documentElement.style;
    const place = () => {
      const offset = `${Math.max(16, Math.round(window.innerHeight - transport.getBoundingClientRect().top + 8))}px`;
      root.setProperty('--toast-offset-mobile', offset);
      root.setProperty('--toast-offset', offset);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(workspaceElement);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.removeProperty('--toast-offset-mobile');
      root.removeProperty('--toast-offset');
    };
  }, [mobile]);

  // Editing `#step-n` in the address bar of an open replay is a same-document navigation: follow it.
  useEffect(() => {
    const onHashChange = () => {
      const target = parsePermalink('', location.hash, bundle.steps.length);
      if (target.step !== undefined) actions.goToStep(target.step);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [actions, bundle.steps.length]);

  useEffect(() => {
    const seekBy = (delta: number) => player.seek(player.getTime() + delta);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || shortcutsOpenRef.current) return;
      const action = shortcutFor(event, event.target instanceof HTMLElement ? event.target : null);
      if (!action) return;
      event.preventDefault();
      switch (action) {
        case 'play-pause':
          return player.playPause();
        case 'seek-back':
          return seekBy(-1000);
        case 'seek-forward':
          return seekBy(1000);
        case 'seek-back-long':
          return seekBy(-5000);
        case 'seek-forward-long':
          return seekBy(5000);
        case 'previous-step':
          return actions.goToPreviousStep();
        case 'next-step':
          return actions.goToNextStep();
        case 'next-error':
          return actions.goToNextError();
        case 'previous-error':
          return actions.goToPreviousError();
        // Step through SPEEDS (clamped, no wrap); keyboard changes flash a HUD on the player.
        case 'speed-up':
        case 'speed-down':
        case 'speed-reset': {
          const current = SPEEDS.indexOf(player.getState().speed);
          const next =
            action === 'speed-reset' ? 1 : SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, current + (action === 'speed-up' ? 1 : -1)))]!;
          player.setSpeed(next);
          return setSpeedHud({ speed: next, id: performance.now() });
        }
        // Tab keys land in the panel: unfold it first, for this action only.
        case 'console-tab':
        case 'network-tab':
        case 'performance-tab':
          if (collapsedRef.current) setCollapsed(false, false);
          return actions.setTab(action === 'console-tab' ? 'console' : action === 'network-tab' ? 'network' : 'performance');
        case 'fullscreen':
          return actions.switchFullscreen();
        case 'shortcuts':
          return actions.openShortcuts();
        case 'switch-inspector':
          return setCollapsed(!collapsedRef.current);
        case 'switch-captions':
          return actions.switchCaptions();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions, player, setCollapsed]);

  return (
    <PlayerContext.Provider value={player}>
      <ViewerContext.Provider value={actions}>
        <main
          ref={shell}
          className="app-shell"
          data-mobile={mobile || undefined}
          data-tab={mobile && stepsSelected ? 'steps' : tab}
          data-inspector-collapsed={collapsed || undefined}
          style={{ '--inspector-height': collapsed && !mobile ? `${INSPECTOR_TABS_HEIGHT}px` : `${inspectorHeight}px` } as CSSProperties}
        >
          {skipLink ? (
            <a className="skip-link" href="#replay-player">
              Skip to replay
            </a>
          ) : null}
          <ViewerHeader
            bundle={bundle}
            compact={mobile}
            menuItems={headerMenuItems}
            {...(menu ? { menu } : {})}
            {...(titleMenu ? { titleMenu } : {})}
            {...(titleFrom ? { titleFrom } : {})}
            {...(backHref ? { backHref } : {})}
            {...(title ? { title } : {})}
            {...(prefix ? { prefix } : {})}
            {...(headerStatus ? { status: headerStatus } : {})}
            {...(suite ? { suite } : {})}
          />
          <div
            ref={workspace}
            className={`workspace ${bundle.steps.length === 0 ? 'no-steps' : ''}`}
            style={stepsWidth ? ({ '--steps-width': `${stepsWidth}px` } as CSSProperties) : undefined}
          >
            <section ref={playerRegion} className="player-region" aria-label="Replay">
              <div className="stage-wrap">
                <PlayerStage />
                {captions && bundle.steps.length > 0 ? <StepCaption /> : null}
                <SkipIndicator />
                {speedHud ? <SpeedHud key={speedHud.id} speed={speedHud.speed} /> : null}
                <FullscreenButton region={playerRegion} />
              </div>
              <Transport />
            </section>
            {bundle.steps.length > 0 && !mobile ? <StepsResizer workspace={workspace} width={stepsWidth} onCommit={setStepsWidth} /> : null}
            {bundle.steps.length > 0 && !mobile ? <StepRail /> : null}
          </div>
          {mobile || collapsed ? null : <InspectorResizer shell={shell} height={inspectorHeight} onCommit={setInspectorHeight} />}
          <Inspector
            bundle={bundle}
            tab={tab}
            expandedRequest={expandedRequest}
            collapse={inspectorCollapse}
            {...(mobilePanel ? { mobile: mobilePanel } : {})}
          />
          <StepAnnouncer />
          <ShortcutSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        </main>
      </ViewerContext.Provider>
    </PlayerContext.Provider>
  );
}

/** Steps passed within this long of each other (a scrub, a held `]`) are announced once, where they settle. */
const STEP_ANNOUNCE_SETTLE_MS = 300;

/**
 * Announces the active step to screen readers politely when it changes (not on first render). The playhead
 * itself is never announced, and a burst of step changes is announced once, after it settles.
 */
function StepAnnouncer() {
  const player = usePlayer();
  const { steps } = useViewer();
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let last = activeStepIndex(steps, player.getTime(), player.duration);
    let timer = 0;
    const unsubscribe = player.subscribeTime(() => {
      const active = activeStepIndex(steps, player.getTime(), player.duration);
      if (active === last) return;
      last = active;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const step = steps[last];
        if (step && region.current) region.current.textContent = `Step ${last + 1} of ${steps.length}: ${step.label}`;
      }, STEP_ANNOUNCE_SETTLE_MS);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [player, steps]);
  return <div ref={region} className="visually-hidden" aria-live="polite" data-testid="step-announcer" />;
}

const ViewerHeader = memo(function ViewerHeader({
  bundle,
  title,
  prefix,
  status,
  suite,
  compact,
  menu,
  menuItems,
  backHref,
  titleMenu,
  titleFrom,
}: {
  bundle: ReplayBundle;
  titleMenu?: ReactNode;
  titleFrom?: string;
  title?: string;
  prefix?: string;
  status?: ReactNode;
  suite?: SuiteDetails;
  compact: boolean;
  menu?: ReactNode;
  menuItems: TopbarMenuItem[];
  backHref?: string;
}) {
  const { meta } = bundle;
  // The chip is for explicit outcomes only (the suite's run status). Raw error counts are details: they live
  // in the Console and Network rows, not in the header.
  const shared = {
    title: title ?? meta.title,
    ...(prefix ? { prefix } : {}),
    ...(status ? { status } : {}),
    ...(backHref ? { backHref } : {}),
    ...(titleMenu ? { titleMenu } : {}),
    ...(titleFrom ? { titleFrom } : {}),
    titleId: 'replay-title',
  };
  if (compact) return <PhoneHeader bundle={bundle} suite={suite} menu={menu} menuItems={menuItems} {...shared} />;
  return (
    <Topbar
      {...shared}
      menu={menu}
      menuItems={menuItems}
      alwaysMenu
      actions={
        // One quiet icon set: details, copy link, download (theme and More come from the Topbar).
        <>
          <ReplayInfoButton bundle={bundle} suite={suite} />
          <CopyLinkButton suiteHref={suite?.href} />
          <DownloadVideoButton meta={bundle.meta} />
        </>
      }
    />
  );
});

/**
 * Phones: details and copy link stay in the bar; download (and the theme) move into "More", so the title keeps
 * its room at 360 px. The render's progress popover anchors at the end of the bar, under "More".
 */
function PhoneHeader({
  bundle,
  suite,
  menu,
  menuItems,
  ...props
}: {
  bundle: ReplayBundle;
  suite: SuiteDetails | undefined;
  menu: ReactNode;
  /** The viewer's own items (Keep), before the downloads. */
  menuItems: TopbarMenuItem[];
  title: string;
  titleId: string;
  prefix?: string;
  status?: ReactNode;
  backHref?: string;
  titleMenu?: ReactNode;
  titleFrom?: string;
}) {
  const download = usePhoneDownload(bundle.meta);
  return (
    <Topbar
      {...props}
      compact
      menu={menu}
      menuItems={[...menuItems, ...download.items]}
      actions={
        <>
          <ReplayInfoButton bundle={bundle} suite={suite} sheet title={props.title} />
          <CopyLinkButton suiteHref={suite?.href} />
          {download.progress}
        </>
      }
    />
  );
}

/** The phone fold's duration and curve match desktop's (styles.css, `[data-inspector-animating]`). */
const PHONE_FOLD_MS = 220;

/**
 * Phones (portrait): the panel's row eases between its open height and its tab row, and the player grows into
 * the space (the desktop fold's calm 220 ms). The open layout is content-sized (the player keeps its aspect
 * ratio), which a grid row cannot interpolate to, so the fold runs on explicit pixel rows (`data-panel-sizing`
 * lets the player fill its row meanwhile) and hands back to the content-sized layout when it lands.
 * Landscape phones put the panel beside the player, where there is nothing to fold.
 */
function foldPhonePanel(shell: HTMLElement, collapse: boolean) {
  const inspector = shell.querySelector<HTMLElement>('.inspector');
  const tabs = shell.querySelector<HTMLElement>('.inspector-tabs');
  const topbar = shell.querySelector<HTMLElement>('.app-topbar');
  const stage = shell.querySelector<HTMLElement>('.player-stage');
  const transport = shell.querySelector<HTMLElement>('.transport');
  if (!inspector || !tabs || !topbar || !stage || !transport) return;
  if (getComputedStyle(shell).gridTemplateColumns.trim().split(/\s+/).length > 1) return;
  const from = inspector.offsetHeight;
  let to = tabs.offsetHeight;
  if (!collapse) {
    // The open player: full width at the recording's aspect ratio, at most 45% of the screen (styles.css).
    const [w = 16, h = 10] = (stage.style.getPropertyValue('--viewport-ratio') || '16 / 10').split('/').map(Number);
    const player = Math.min((stage.clientWidth * h) / w, window.innerHeight * 0.45);
    const padding = Number.parseFloat(getComputedStyle(shell).paddingBottom) || 0;
    to = Math.max(tabs.offsetHeight, shell.clientHeight - padding - topbar.offsetHeight - player - transport.offsetHeight);
  }
  window.clearTimeout(Number(shell.dataset.foldTimer ?? 0));
  delete shell.dataset.inspectorAnimating;
  shell.dataset.panelSizing = '';
  shell.style.gridTemplateRows = `auto minmax(0, 1fr) ${from}px`;
  void shell.offsetHeight;
  shell.dataset.inspectorAnimating = '';
  shell.style.gridTemplateRows = `auto minmax(0, 1fr) ${to}px`;
  shell.dataset.foldTimer = String(
    window.setTimeout(() => {
      shell.style.gridTemplateRows = '';
      delete shell.dataset.panelSizing;
      delete shell.dataset.inspectorAnimating;
      delete shell.dataset.foldTimer;
    }, PHONE_FOLD_MS + 40),
  );
}

/**
 * Step captions: the current step's label as a calm caption at the bottom of the player while it plays, and
 * while you scrub or seek (pointer drag, touch drag, keys, a step click) and stay paused there; a pause without
 * a seek, or the end, clears it. The caption fades in once; then the label morphs from step to step, and a fast
 * drag across many steps swaps it instantly, so it never flickers.
 */
function StepCaption() {
  const player = usePlayer();
  const { steps } = useViewer();
  const { status } = usePlayerState();
  // The same step index the step rail shows (one source), so caption and rail never disagree at a boundary.
  const active = useActiveStep(steps);
  const [seeked, setSeeked] = useState(false);
  useEffect(() => {
    const offSeek = player.subscribeSeek(() => setSeeked(true));
    const offState = player.subscribeState(() => {
      const next = player.getState().status;
      if (next === 'playing' || next === 'ended') setSeeked(false);
    });
    return () => {
      offSeek();
      offState();
    };
  }, [player]);
  const step = steps[active];
  const playing = status === 'playing';
  if (!step || !(playing || (seeked && status !== 'ended'))) return null;
  return (
    <div className="step-caption" aria-hidden="true" data-testid="step-caption">
      {/* One persistent caption: it fades in once, then the label morphs from step to step (AnimatedText); a fast
          scrub swaps it instantly. */}
      <span className="step-caption-text">
        <span className="step-caption-number">{active + 1}</span>
        <AnimatedText className="step-caption-label" text={step.label} />
      </span>
    </div>
  );
}

/**
 * Copy link: a click copies the plain link (no time, no step; a suite run keeps its /s/…/r/… path). Right-click,
 * a long press, or the context-menu key (Shift+F10) open a small menu anchored to the button: the plain link, the
 * link at the playhead, the link to the current step and, in a suite, the suite. Each copies and says what.
 */
/** The page's link without a moment: no ?t=, no #step-n (a suite run keeps its /s/…/r/… path). */
/** How long a finger rests on "Copy link" before its menu opens. */
const LONG_PRESS_MS = 450;
/** Set once the copy-link menu has been opened by any route; then the touch hint stops. */
const LONG_PRESS_HINT_KEY = 'replays-copy-menu-found';

function plainLink() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function CopyLinkButton({ suiteHref }: { suiteHref?: string | undefined }) {
  const player = usePlayer();
  const { steps } = useViewer();
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const press = useRef({ timer: 0, x: 0, y: 0, fired: false, holding: false });
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = (href: string, what: string, hint?: string) => {
    void copyText(href).then((ok) => {
      showToast(ok ? `${what} copied` : 'Could not copy the link', undefined, ok ? hint : undefined);
      if (ok) setCopied(true);
    });
  };
  const openMenu = () => {
    setMenuOpen(true);
    writeStorage(LONG_PRESS_HINT_KEY, '1');
  };
  const cancelPress = () => window.clearTimeout(press.current.timer);
  const releasePress = () => {
    cancelPress();
    // The menu's outside-press check runs on this same release (a document listener, before this one).
    window.setTimeout(() => {
      press.current.holding = false;
    });
  };
  const time = player.getTime();
  const stepIndex = activeStepIndex(steps, time, player.duration);
  const step = steps[stepIndex];
  return (
    <>
      <IconButton
        ref={button}
        label="Copy link"
        hint={
          <>
            {/* The tooltip says what just happened ("Copied") and morphs back. */}
            <AnimatedText text={copied ? 'Copied' : 'Copy link'} />
            <span className="hint-secondary">Right-click for more</span>
          </>
        }
        tooltipSide="bottom"
        tooltipAlign="end"
        className="copy-link"
        data-testid="copy-link"
        aria-haspopup="menu"
        onClick={(event) => {
          // The click that ends a long press is not a copy: the menu it opened stays up.
          if (press.current.fired) {
            press.current.fired = false;
            event.preventDefault();
            return;
          }
          // Touch has no right-click or tooltip: until the menu has been found once, the toast says how to get it.
          const touch = (event.nativeEvent as PointerEvent).pointerType === 'touch';
          copy(
            plainLink(),
            'Link',
            touch && !readStorage(LONG_PRESS_HINT_KEY) ? 'Press and hold for a link to this moment or step' : undefined,
          );
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          // Android also fires contextmenu on a long press; the press timer has usually opened the menu already.
          if (!menuOpen) openMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            openMenu();
          }
        }}
        onPointerDown={(event) => {
          press.current.fired = false;
          if (event.pointerType !== 'touch') return;
          cancelPress();
          press.current.x = event.clientX;
          press.current.y = event.clientY;
          press.current.timer = window.setTimeout(() => {
            press.current.fired = true;
            press.current.holding = true;
            openMenu();
          }, LONG_PRESS_MS);
        }}
        onPointerMove={(event) => {
          // A finger that drifts off (a scroll, a swipe) is not a long press.
          if (Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) cancelPress();
        }}
        onPointerUp={releasePress}
        onPointerCancel={releasePress}
        onPointerLeave={cancelPress}
      >
        <span className="icon-swap" data-state={copied ? 'b' : 'a'} aria-hidden="true">
          <AnimatedIcon name="link" className="icon-a" />
          <AnimatedIcon name="check" className="icon-b" trigger="state" play={copied ? 'copied' : false} />
        </span>
      </IconButton>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(next, details) => {
          // Lifting the finger that long-pressed lands outside the new menu: that is not a dismissal.
          if (!next && press.current.holding && details.reason === 'outside-press') return;
          setMenuOpen(next);
        }}
      >
        <DropdownMenuContent anchor={button} align="end" className="w-auto min-w-56" aria-label="Copy link">
          <DropdownMenuItem onClick={() => copy(plainLink(), 'Link')}>Copy link</DropdownMenuItem>
          <DropdownMenuItem onClick={() => copy(timePermalink(location.href, time), `Link at ${formatClock(time)}`)}>
            Copy link at {formatClock(time)}
          </DropdownMenuItem>
          {step ? (
            <DropdownMenuItem onClick={() => copy(stepPermalink(location.href, stepIndex), `Link to step ${stepIndex + 1}`)}>
              <span className="min-w-0 truncate">
                Copy link to step {stepIndex + 1} · {step.label}
              </span>
            </DropdownMenuItem>
          ) : null}
          {suiteHref ? (
            <DropdownMenuItem onClick={() => copy(new URL(suiteHref, location.href).toString(), 'Suite link')}>
              Copy suite link
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/**
 * While "skip inactive" fast-forwards an idle gap: a small pill on the player, bottom-left ("Skipping 4.2 s of
 * inactivity"), fading in and out; announced once per skip through a polite region.
 */
function SkipIndicator() {
  const { skipping } = usePlayerState();
  const seconds = skipping ? ((skipping.to - skipping.from) / 1000).toFixed(1) : undefined;
  return (
    <>
      <div className="skip-indicator" data-visible={skipping ? '' : undefined} aria-hidden="true" data-testid="skip-indicator">
        <FastForwardIcon aria-hidden="true" />
        {seconds ? `Skipping ${seconds} s of inactivity` : null}
      </div>
      <span className="visually-hidden" role="status">
        {seconds ? `Skipping ${seconds} seconds of inactivity` : ''}
      </span>
    </>
  );
}

/** A keyboard speed change flashes the new rate on the player: fade/scale in, hold, fade out (CSS animation). */
function SpeedHud({ speed }: { speed: number }) {
  return (
    <div className="speed-hud" aria-hidden="true" data-testid="speed-hud">
      {speed}×
    </div>
  );
}

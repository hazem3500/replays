import { ChevronDownIcon, FastForwardIcon, PencilIcon, PinIcon, PinOffIcon, PuzzleIcon } from 'lucide-react';
import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { AnimatedText } from '@/components/animated-text.tsx';
import { CaptionMorph } from './CaptionMorph.tsx';
import { type CSSProperties, lazy, memo, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  applyEdits,
  type EditTimeline,
  editListOf,
  editTimeline,
  editsVersion,
  isEmptyEdits,
  type ReplayHighlight,
  type StoredReplayEdits,
} from '../shared/edits.ts';
import { projectHighlights } from '../shared/highlights.ts';
import type { PlaybackEffects } from '../shared/effects.ts';
import { formatClock, type ReplayBundle } from '../shared/replay.ts';
import { editingEnabled } from './config.ts';
import { FeatureProviders } from './plugins/features.tsx';
import { EditCaption } from './edit-caption.tsx';
import type { LoadedEdits } from './edits.ts';
import { comparisonHref, editHref } from './route.ts';
import { savedAgo } from './editor/state.ts';
import { clearHandoff, peekHandoff } from './editor/handoff.ts';
import { copyText } from './clipboard.ts';
import { notify as showToast } from './toast.ts';
import { betaMalleable } from './malleable/flag.ts';
import { replayPurpose } from './purposes.ts';
import { DEFAULT_LEAD_MS } from '../shared/purposes.ts';
import { openWorkshop } from './malleable/ui-state.ts';
import { PluginContexts, usePluginContexts, usePluginMenu } from './plugins/PluginUi.tsx';
import { collectErrors, nextError, previousError, type ReplayError } from './issues.ts';
import { parsePermalink, stepPermalink, timePermalink } from './permalink.ts';
import { PlayerContext, ReplayController, SPEEDS, usePlayer, usePlayerState, usePlayhead } from './player.ts';
import { shortcutFor, shortcutLabel } from './shortcuts.ts';
import { nextStepIndex, previousStepIndex } from './timeline.ts';
import { type InspectorTab, useViewer, type ViewerActions, ViewerContext } from './viewer/context.ts';
import { DownloadVideoButton, usePhoneDownload } from './viewer/DownloadVideo.tsx';
import { useActiveStep } from './viewer/active-step.ts';
// The caption's look is shared with exported videos (render page); the viewer must load it itself.
import './step-caption.css';
import { captionAt } from './step-caption.ts';
import { clampInspectorHeight, initialInspectorHeight, Inspector, InspectorResizer, type MobilePanel } from './viewer/Inspector.tsx';
import { MOBILE_QUERY, useMediaQuery } from './media.ts';
import { ShortcutSheet } from './viewer/ShortcutSheet.tsx';
import { savedStepsWidth, StepRail, StepsResizer } from './viewer/StepRail.tsx';
import { activeStepIndex, FullscreenButton, PlayerStage, Transport } from './viewer/Transport.tsx';

import { Topbar, type TopbarMenuItem } from './Topbar.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { SourceChip, topbarSource } from './viewer/SourceChip.tsx';
import { Hint, IconButton } from '@/components/icon-button.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';
import { cn } from '@/lib/utils.ts';
import { readStorage, writeStorage } from './storage.ts';
import { ReplayInfoButton, type SuiteDetails } from './viewer/ReplayInfo.tsx';
import { useKeep } from './viewer/keep.ts';

// Beta (beta.malleable): the plugin workshop and prompts. Never requested with the flag off.
const MalleableHost = lazy(() => import('./malleable/MalleableHost.tsx'));

const INSPECTOR_COLLAPSED_KEY = 'replays-inspector-collapsed';
const CAPTIONS_KEY = 'replays-captions';
const CAPTION_NUMBERS_KEY = 'replays-caption-numbers';
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
  edited,
  effects,
  timeline,
  highlights,
  sourceBundle = bundle,
}: {
  bundle: ReplayBundle;
  /** Original diagnostics for the waterfall's measured spans when playback has saved edits. */
  sourceBundle?: ReplayBundle;
  /** Saved edits' timeline (source ↔ edited time) when they are applied: comments are anchored to source time. */
  timeline?: EditTimeline;
  /** Saved playback navigation annotations, stored on the source timeline. */
  highlights?: ReplayHighlight[];
  /** Zoom, blur and captions from the saved edits, on this bundle's timeline. */
  effects?: PlaybackEffects;
  /** The replay has saved edits: who and when, whether the original is on screen, and the switch between them. */
  edited?: EditedState;
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
  // The deployment's purpose for this replay (src/client/purposes.ts) sets how it first opens.
  const purpose = useMemo(() => replayPurpose(bundle), [bundle]);
  const opened = useMemo(() => {
    const controller = new ReplayController(bundle, effects ? { effects } : {});
    // Permalinks open paused at their moment.
    const target = parsePermalink(location.search, location.hash, bundle.steps.length);
    // Back from edit mode (Done): resume at the editor's playhead, on this (edited) timeline, and play.
    const handoff = peekHandoff(bundle.meta.id);
    const at = handoff ? handoff.time : target.step === undefined ? target.time : bundle.steps[target.step]?.at;
    if (at !== undefined) controller.seek(at);
    // `openAt: 'first-error'` (a bug reproduction): just before the first error, on the tab that holds it. Permalinks win.
    const firstError = purpose?.viewer?.openAt === 'first-error' && at === undefined ? errors[0] : undefined;
    if (firstError) controller.seek(Math.max(0, firstError.at - (purpose?.viewer?.leadMs ?? DEFAULT_LEAD_MS)));
    const step = target.step === undefined ? undefined : { index: target.step, time: controller.getTime() };
    return { controller, step, resume: Boolean(handoff), tab: firstError?.kind };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- effects only change with the bundle (EditedViewer remounts)
  }, [bundle]);
  const player = opened.controller;
  // Resuming from the editor: play as soon as the replay is mounted (it mounts after the page transition).
  useEffect(() => {
    if (!opened.resume) return;
    clearHandoff(bundle.meta.id);
    let frame = 0;
    const started = performance.now();
    const tryPlay = () => {
      if (player.wrapper) player.play();
      else if (performance.now() - started < 5000) frame = requestAnimationFrame(tryPlay);
    };
    frame = requestAnimationFrame(tryPlay);
    return () => cancelAnimationFrame(frame);
  }, [bundle.meta.id, opened, player]);
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
  const [tab, setTabState] = useState<InspectorTab>(() => opened.tab ?? initialTab);
  // Step captions on the player: the person's stored choice, else the purpose's default (off without one).
  const [captions, setCaptionsState] = useState(() => {
    const saved = readStorage(CAPTIONS_KEY);
    return saved === '1' ? true : saved === '0' ? false : purpose?.viewer?.captions === true;
  });
  const switchCaptions = useCallback(() => {
    setCaptionsState((current) => {
      writeStorage(CAPTIONS_KEY, current ? '0' : '1');
      return !current;
    });
  }, []);
  // Viewer-only presentation, independent of caption visibility and saved editor captions.
  const [captionNumbers, setCaptionNumbersState] = useState(() => readStorage(CAPTION_NUMBERS_KEY) === '1');
  const setCaptionNumbers = useCallback((next: boolean) => {
    writeStorage(CAPTION_NUMBERS_KEY, next ? '1' : '0');
    setCaptionNumbersState(next);
  }, []);
  // The bottom panel folds to its tab row (desktop). Remembered; when nothing is stored, the purpose's default (open without one).
  const [collapsed, setCollapsedState] = useState(() => {
    // Opening on an error shows the panel that holds it (for this visit; the stored choice stands).
    if (opened.tab) return false;
    const saved = readStorage(INSPECTOR_COLLAPSED_KEY);
    return saved === '1' ? true : saved === '0' ? false : purpose?.viewer?.inspector === 'collapsed';
  });
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
  // Built-in features (plugins/features.tsx, e.g. comments): opening their tab unfolds the panel when it is folded, and a
  // feature's key (`M`) reaches it through the action it registered.
  const startComment = useRef<() => void>(undefined);
  const registerStartAction = useCallback((start: (() => void) | undefined) => {
    startComment.current = start;
  }, []);
  const openFeaturePanel = useCallback(
    (target: string) => {
      if (collapsedRef.current) setCollapsed(false, false);
      setTab(target as InspectorTab);
    },
    [setCollapsed, setTab],
  );

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
      captionNumbers,
      setCaptionNumbers,
      openShortcuts: () => {
        setShortcutsOpen(true);
      },
      notify,
      editsVersion: edited ? editsVersion(editListOf(edited.stored)) : '',
      editCaptions: Boolean(effects?.captions.length),
      highlights: projectHighlights(highlights, timeline ?? editTimeline(undefined, player.duration)),
    };
  }, [
    bundle.steps,
    captionNumbers,
    captions,
    edited,
    effects,
    highlights,
    timeline,
    errors,
    notify,
    player,
    setCaptionNumbers,
    setCollapsed,
    setTab,
    switchCaptions,
  ]);

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
  // Client plugins (src/client/plugins/): one context per plugin for this replay; their actions and panel entries are
  // More-menu items (bar actions are header buttons on desktop), their settings close the menu, open panels draw in a drawer.
  const pluginContexts = usePluginContexts(bundle, player);
  const pluginMenu = usePluginMenu(pluginContexts, mobile);
  // Memoised so the (memo) header does not re-render on inspector tab switches.
  const headerMenuItems = useMemo<TopbarMenuItem[]>(
    () => [
      ...(keepItem ? [keepItem] : []),
      {
        label: 'Compare recordings',
        icon: <AnimatedIcon name="search" />,
        href: comparisonHref(bundle.meta.id, bundle.meta.id),
        onSelect: () => {},
        detail: 'Beta',
      },
      ...pluginMenu.items,
      ...(betaMalleable()
        ? [{ label: 'Plugin workshop', icon: <PuzzleIcon aria-hidden="true" />, onSelect: openWorkshop, testId: 'malleable-open' }]
        : []),
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
    [actions.openShortcuts, bundle.meta.id, keepItem, mobile, pluginMenu.items],
  );
  // The run's own first source wins; a run opened in a suite without one shows the suite's subject, so every run
  // of a review carries the same chip.
  const source = useMemo(() => topbarSource(bundle.context?.sources, suite?.subject), [bundle.context?.sources, suite?.subject]);
  const inspectorCollapse = useMemo(() => ({ collapsed, onCollapsedChange: setCollapsed }), [collapsed, setCollapsed]);
  const headerStatus = useMemo(
    () =>
      status || source || edited ? (
        <>
          {status}
          {edited ? <EditedChip id={bundle.meta.id} edited={edited} fresh={opened.resume} /> : null}
          {source ? <SourceChip source={source} /> : null}
        </>
      ) : undefined,
    [bundle.meta.id, edited, opened.resume, source, status],
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
        case 'add-comment':
          return startComment.current?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions, player, setCollapsed]);

  const viewer = (
    <ViewerContext.Provider value={actions}>
      <main
        ref={shell}
        className="app-shell"
        data-mobile={mobile || undefined}
        data-tab={mobile && stepsSelected ? 'steps' : tab}
        data-inspector-collapsed={collapsed || undefined}
        data-purpose={purpose?.id}
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
          pluginActions={pluginMenu.bar}
          menuFooter={pluginMenu.settings}
          {...(menu ? { menu } : {})}
          {...(titleMenu ? { titleMenu } : {})}
          {...(titleFrom ? { titleFrom } : {})}
          {...(backHref ? { backHref } : {})}
          {...(title ? { title } : {})}
          {...(prefix ? { prefix } : {})}
          {...(headerStatus ? { status: headerStatus } : {})}
          {...(suite ? { suite } : {})}
          hasEdits={Boolean(edited)}
        />
        <div
          ref={workspace}
          className={`workspace ${bundle.steps.length === 0 ? 'no-steps' : ''}`}
          style={stepsWidth ? ({ '--steps-width': `${stepsWidth}px` } as CSSProperties) : undefined}
        >
          <section ref={playerRegion} className="player-region" aria-label="Replay">
            <div className="stage-wrap">
              <PlayerStage />
              {effects?.captions.length ? (
                <EditCaption captions={effects.captions} />
              ) : captions && bundle.steps.length > 0 ? (
                <StepCaption />
              ) : null}
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
          sourceBundle={sourceBundle}
          timeline={timeline}
          tab={tab}
          expandedRequest={expandedRequest}
          collapse={inspectorCollapse}
          {...(mobilePanel ? { mobile: mobilePanel } : {})}
        />
        <StepAnnouncer />
        {pluginMenu.drawer}
        {betaMalleable() ? (
          <Suspense fallback={null}>
            <MalleableHost bundle={bundle} player={player} />
          </Suspense>
        ) : null}
        <ShortcutSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      </main>
    </ViewerContext.Provider>
  );
  return (
    <PlayerContext.Provider value={player}>
      <PluginContexts.Provider value={pluginContexts}>
        <FeatureProviders
          replayId={bundle.meta.id}
          timeline={timeline}
          openPanel={openFeaturePanel}
          registerStartAction={registerStartAction}
        >
          {viewer}
        </FeatureProviders>
      </PluginContexts.Provider>
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
  menuFooter,
  pluginActions,
  backHref,
  titleMenu,
  titleFrom,
  hasEdits = false,
}: {
  bundle: ReplayBundle;
  /** The replay has saved edits: a dot on the Edit button (the title shows "Edited …" as quiet text). */
  hasEdits?: boolean;
  /** Client plugins' settings, at the bottom of the More menu. */
  menuFooter: ReactNode;
  /** Client plugins' bar actions (desktop): icon buttons after the built-in ones. */
  pluginActions: ReactNode;
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
  if (compact)
    return (
      <PhoneHeader
        bundle={bundle}
        suite={suite}
        menu={menu}
        menuItems={menuItems}
        menuFooter={menuFooter}
        hasEdits={hasEdits}
        {...shared}
      />
    );
  return (
    <Topbar
      {...shared}
      menu={menu}
      menuItems={menuItems}
      menuFooter={menuFooter}
      alwaysMenu
      actions={
        // One quiet icon set: edit, details, copy link and download.
        <>
          {editingEnabled() ? <EditButton id={bundle.meta.id} hasEdits={hasEdits} /> : null}
          <ReplayInfoButton bundle={bundle} suite={suite} />
          <CopyLinkButton suiteHref={suite?.href} />
          <DownloadVideoButton meta={bundle.meta} />
          {pluginActions}
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
  menuFooter,
  hasEdits = false,
  ...props
}: {
  bundle: ReplayBundle;
  hasEdits?: boolean;
  suite: SuiteDetails | undefined;
  menu: ReactNode;
  menuFooter: ReactNode;
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
      menuFooter={menuFooter}
      actions={
        <>
          {editingEnabled() ? <EditButton id={bundle.meta.id} hasEdits={hasEdits} /> : null}
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
 * a seek, or the end, clears it. The stable caption host retargets its shared characters between step labels.
 */
function StepCaption() {
  const player = usePlayer();
  const { steps, captionNumbers } = useViewer();
  const { status } = usePlayerState();
  // The same step index the step rail shows (one source), so caption and rail never disagree at a boundary.
  const activeIndex = useActiveStep(steps);
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
  const captionIndex = usePlayhead((time) => captionAt(steps, time, player.duration)?.index ?? -1);
  const step = steps[captionIndex];
  const playing = status === 'playing';
  const active = Boolean(step && (playing || (seeked && status !== 'ended')));
  const label = active ? (step?.label ?? '') : '';
  return (
    <div
      className="step-caption step-caption-live"
      data-active={active ? 'true' : 'false'}
      data-testid="step-caption"
      role="status"
      aria-live="off"
      aria-label={label || undefined}
    >
      {/* why: one stable caption host lets Calligraph retarget characters as the current step changes. */}
      <span className="step-caption-text">
        {active && captionNumbers ? (
          <span className="step-caption-number" aria-hidden="true">
            {activeIndex + 1}
          </span>
        ) : null}
        <span className="step-caption-label" aria-hidden="true">
          <CaptionMorph text={label} />
        </span>
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

/** Edit uses the same quiet icon button as the viewer's other toolbar actions; a dot on it says the replay has edits. */
function EditButton({ id, hasEdits = false }: { id: string; hasEdits?: boolean }) {
  return (
    <Hint label={hasEdits ? 'Edit replay · This replay has edits' : 'Edit replay · Trim, cut and add effects'} side="bottom" align="end">
      <a
        href={editHref(id)}
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'edit-entry text-[var(--text-secondary)] hover:text-foreground [&_svg:not([class*=size-])]:size-4',
        )}
        aria-label={hasEdits ? 'Edit replay (has edits)' : 'Edit replay'}
        data-testid="edit-replay"
        data-has-edits={hasEdits || undefined}
      >
        <AnimatedIcon name="pencil" />
      </a>
    </Hint>
  );
}

/** What the viewer knows about a replay's saved edits. */
export interface EditedState {
  stored: StoredReplayEdits;
  /** The original (unedited) replay is on screen. */
  original: boolean;
  setOriginal: (original: boolean) => void;
}

/**
 * The edit state as quiet text beside the title ("Edited 2h ago", no border — the run status is the row's one strong
 * mark), and its menu: who saved the edits and when, a switch to the original recording (and back), and edit mode.
 * Reads "Original recording" while the original is shown.
 */
function EditedChip({ id, edited, fresh = false }: { id: string; edited: EditedState; fresh?: boolean }) {
  const { stored, original, setOriginal } = edited;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="edited-chip"
            data-fresh={fresh || undefined}
            data-testid="edited-chip"
            aria-label={original ? 'Showing the original recording' : 'Edited replay'}
          />
        }
      >
        <span className="edited-label">
          {original ? 'Original recording' : stored.updatedAt ? `Edited ${savedAgo(stored.updatedAt)}` : 'Edited'}
          <ChevronDownIcon aria-hidden="true" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-auto min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal text-[var(--text-tertiary)]">
            {stored.updatedBy ? `Edited by ${stored.updatedBy}` : 'Edited'}
            {stored.updatedAt ? ` · ${savedAgo(stored.updatedAt)}` : ''}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuItem onClick={() => setOriginal(!original)} data-testid="switch-original">
          {original ? 'View edited' : 'View original'}
        </DropdownMenuItem>
        {editingEnabled() ? (
          <DropdownMenuItem render={<a href={editHref(id)} className="menu-link" />} data-testid="open-editor">
            <PencilIcon aria-hidden="true" />
            Open editor
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** `?original=1` shows the recording as captured; times in `?t=` and `#step-n` belong to one version, so a switch drops them. */
function readOriginal() {
  return new URLSearchParams(location.search).get('original') === '1';
}

/**
 * The viewer with the replay's saved edits applied (src/shared/edits.ts): trims and cuts played seamlessly, steps and
 * rows inside them gone, every time on the edited timeline. `edits` undefined (none, or they failed to load) shows the
 * replay as recorded. Remounts the player when the version on screen changes.
 */
export function EditedViewer({ edits, ...props }: Parameters<typeof Viewer>[0] & { edits: LoadedEdits | undefined }) {
  const { bundle } = props;
  const [original, setOriginalState] = useState(readOriginal);
  const stored = edits?.stored;
  const hasEdits = Boolean(stored && !isEmptyEdits(stored));
  const shown = useMemo(
    () => (stored && hasEdits && !original ? applyEdits(bundle, editListOf(stored)) : undefined),
    [bundle, hasEdits, original, stored],
  );
  const setOriginal = useCallback((next: boolean) => {
    const url = new URL(location.href);
    url.searchParams.delete('t');
    url.hash = '';
    if (next) url.searchParams.set('original', '1');
    else url.searchParams.delete('original');
    history.replaceState(history.state, '', url);
    setOriginalState(next);
  }, []);
  const edited = useMemo(
    () => (stored && hasEdits ? { stored, original, setOriginal } : undefined),
    [hasEdits, original, setOriginal, stored],
  );
  return (
    <Viewer
      key={`${bundle.meta.id}:${original ? 'original' : (stored?.revision ?? 0)}`}
      {...props}
      bundle={shown?.bundle ?? bundle}
      sourceBundle={bundle}
      {...(shown ? { effects: shown.effects, timeline: shown.timeline } : {})}
      {...(stored?.highlights ? { highlights: stored.highlights } : {})}
      {...(edited ? { edited } : {})}
    />
  );
}

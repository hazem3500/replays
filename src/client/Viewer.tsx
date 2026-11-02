import { usePluginShortcuts } from './hooks/use-plugin-shortcuts.ts';
import { useHasKeyboard } from './hooks/use-has-keyboard.ts';

import { usePluginEvents } from './hooks/use-plugin-events.ts';
import { ChevronDownIcon, Columns2Icon, FastForwardIcon, PencilIcon, PlusIcon, PuzzleIcon } from 'lucide-react';
import { AnimatedIcon } from '@/components/animated-icon.tsx';
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
import { StepCaption } from './viewer/StepCaption.tsx';
import type { LoadedEdits } from './edits.ts';
import { editHref } from './routing/links.ts';
import { savedAgo } from './editor/state.ts';
import { clearHandoff, peekHandoff } from './editor/handoff.ts';
import { copyText } from './clipboard.ts';
import { notify as showToast } from './toast.ts';
import { compareWith } from './compare/open.ts';
import { betaMalleable } from './malleable/flag.ts';
import { replayProfile } from './profiles.ts';
import { openWorkshop } from './malleable/ui-state.ts';
import { PluginContexts, usePluginContexts, usePluginMenu } from './plugins/PluginUi.tsx';
import { collectErrors, nextError, previousError, type ReplayError } from './issues.ts';
import { parsePermalink, stepPermalink, timePermalink } from './permalink.ts';
import { type Playback, PlayerContext, ReplayController, SPEEDS, usePlayer, usePlayerState } from './player.ts';
import { shortcutFor, shortcutLabel } from './shortcuts.ts';
import { nextStepIndex, previousStepIndex } from './timeline.ts';
import { type InspectorTab, useViewer, type ViewerActions, ViewerContext } from './viewer/context.ts';
import { useDownloadMenu } from './viewer/DownloadVideo.tsx';
import { copyLinkItems, EditButton, ActionsBar } from './viewer/TopbarActions.tsx';
// The caption's look is shared with exported videos (render page); the viewer must load it itself.
import './step-caption.css';
import { Inspector, type InspectorPeer, type MobilePanel } from './viewer/Inspector.tsx';
import { clampInspectorHeight } from './viewer/inspector-size.ts';
import { MOBILE_QUERY, STACKED_QUERY, useMediaQuery } from './media.ts';
import { ShortcutSheet } from './viewer/ShortcutSheet.tsx';
import { savedStepsWidth, StepRail } from './viewer/StepRail.tsx';
import { InspectorSplit, RailEdgeTab, RailSplit } from './viewer/ViewerSplits.tsx';
import { usePageView } from './hooks/use-page-view.ts';
import { useQuietPlaying } from './hooks/use-quiet-chrome.ts';
import { useWindowKeydown } from './hooks/use-window-keydown.ts';
import { useViewState } from './hooks/use-view-state.ts';
import { pageViews } from './views/catalog.ts';
import { resolvePageView } from './views/page-view.ts';
import { cycleView, switcherViews, viewDefaults } from './views/resolve.ts';
import { viewSettingKey } from './views/settings.ts';
import { ResetViewItem, type ViewChoice, ViewMenuItems } from './views/ViewSwitcher.tsx';
// oxlint-disable-next-line import/no-unassigned-import -- why: the viewer's layout tokens and seams load with the lazy viewer chunk.
import './viewer/viewer-layout.css';
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
import { readStorage, writeStorage } from './storage.ts';
import { ReplayInfoButton, type SuiteDetails } from './viewer/ReplayInfo.tsx';
import { DesktopHeader } from './viewer/DesktopHeader.tsx';
import { setPageUrl } from './routing/navigate.ts';

// Beta (beta.malleable): the plugin workshop and prompts. Never requested with the flag off.
const MalleableHost = lazy(() => import('./malleable/MalleableHost.tsx'));
// why: a headline (and its tiles' code and styles) loads only for views that list one.
const ViewHeadline = lazy(() => import('./views/Headline.tsx').then((module) => ({ default: module.ViewHeadline })));
const ComparePicker = lazy(() => import('./compare/ComparePicker.tsx').then((module) => ({ default: module.ComparePicker })));

const CAPTION_NUMBERS_KEY = 'replays-caption-numbers';
/** A folded panel keeps just its tab row (36 px) and the hairline above it. */
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
  player: sharedPlayer,
  stage,
  headerActions,
  inspectorScope,
  inspectorPeers,
  comparing,
  onCompareWith,
  suiteProfile,
  compareSummary,
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
  /** Compared recordings' shared clock, scoped to `bundle` (the focused one): it replaces this replay's own player. */
  player?: Playback;
  /** In place of the player stage: the compared recordings' tiles. */
  stage?: ReactNode;
  /** Before the header's icon actions: the comparison's layout switch. */
  headerActions?: ReactNode;
  /** In the inspector's tab row: which compared recording the panels describe. */
  inspectorScope?: ReactNode;
  /** The other compared recordings: Network and Performance say how each one went beside this one. */
  inspectorPeers?: readonly InspectorPeer[];
  /** Recordings already on the stage, left out of "Compare with…". */
  comparing?: readonly string[];
  /** "Compare with…" picked a recording; by default this replay's URL gains it and shows both in a grid. */
  onCompareWith?: (id: string) => void;
  /** On a suite page, the suite's profile: it can name the view (views/resolve.ts). */
  suiteProfile?: string | undefined;
  /** Comparing: the per-recording chips the Compare view's headline shows. */
  compareSummary?: ReactNode;
}) {
  const errors = useMemo(() => collectErrors(bundle), [bundle]);
  const profile = useMemo(() => replayProfile(bundle), [bundle]);
  // why: the page's view (`?view=`, the suite's or replay's profile, the number of recordings) sets how it opens and lays out.
  const comparisonContext = Boolean(stage && (comparing?.length ?? 0) > 1);
  const page = usePageView({ replay: bundle, suiteProfile, recordings: comparing?.length ?? 1, comparison: comparisonContext });
  const defaults = viewDefaults(page);
  const opened = useMemo(() => {
    if (sharedPlayer) return { controller: sharedPlayer, step: undefined, resume: false, tab: undefined };
    const controller = new ReplayController(bundle, effects ? { effects } : {});
    // Permalinks open paused at their moment.
    const target = parsePermalink(location.search, location.hash, bundle.steps.length);
    // Back from edit mode (Done): resume at the editor's playhead, on this (edited) timeline, and play.
    const handoff = peekHandoff(bundle.meta.id);
    const at = handoff ? handoff.time : target.step === undefined ? target.time : bundle.steps[target.step]?.at;
    if (at !== undefined) controller.seek(at);
    // `openAt: 'first-error'` (a bug reproduction): just before the first error, on the tab that holds it. Permalinks win.
    const firstError = defaults.openAt === 'first-error' && at === undefined ? errors[0] : undefined;
    if (firstError) controller.seek(Math.max(0, firstError.at - defaults.leadMs));
    const speed = SPEEDS.find((candidate) => candidate === defaults.speed);
    if (speed) controller.setSpeed(speed);
    const step = target.step === undefined ? undefined : { index: target.step, time: controller.getTime() };
    return { controller, step, resume: Boolean(handoff), tab: firstError?.kind };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- effects only change with the bundle (EditedViewer remounts)
  }, [bundle, sharedPlayer]);
  const player: Playback = opened.controller;
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const shortcutsOpenRef = useRef(false);
  useEffect(() => {
    shortcutsOpenRef.current = shortcutsOpen;
  }, [shortcutsOpen]);
  const layout = useViewState(page.view.id, defaults, { errorTab: opened.tab, fallbackTab: initialTab });
  const inspectorHeight = layout.height;
  const setInspectorHeight = layout.setHeight;
  const [speedHud, setSpeedHud] = useState<{ speed: number; id: number }>();
  const [stepsWidth, setStepsWidth] = useState(savedStepsWidth);
  const { railCollapsed, setRailCollapsed, tab, captions, switchCaptions } = layout;
  const workspace = useRef<HTMLDivElement>(null);
  usePluginEvents(bundle.meta.id, tab, player);
  // Viewer-only presentation, independent of caption visibility and saved editor captions.
  const [captionNumbers, setCaptionNumbersState] = useState(() => readStorage(CAPTION_NUMBERS_KEY) === '1');
  const setCaptionNumbers = useCallback((next: boolean) => {
    writeStorage(CAPTION_NUMBERS_KEY, next ? '1' : '0');
    setCaptionNumbersState(next);
  }, []);
  // why: stacked layouts keep Steps in the inspector, so even a hidden inspector must keep its tab row.
  const mobile = useMediaQuery(MOBILE_QUERY);
  const stacked = useMediaQuery(STACKED_QUERY);
  const hidden = layout.hidden && !stacked;
  const collapsed = layout.collapsed || (layout.hidden && stacked);
  /** `persist: false` is a transient change for one action (a shortcut that needs the panel), not a preference. */
  const { setCollapsed: storeCollapsed, setTab: storeTab } = layout;
  const setCollapsed = useCallback(
    (next: boolean, persist = true) => {
      // Animate the fold only for this change (never while the resizer drags).
      const element = shell.current;
      if (element && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        if (element.dataset.mobile !== undefined) foldPhonePanel(element, next);
        else {
          element.dataset.inspectorAnimating = '';
          window.setTimeout(() => delete element.dataset.inspectorAnimating, 260);
        }
      }
      storeCollapsed(next, persist);
    },
    [storeCollapsed],
  );
  const collapsedRef = useRef(collapsed);
  useEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);
  // why: stacked layouts share one panel, with Steps selected until a diagnostics tab is chosen.
  const [stepsSelected, setStepsSelected] = useState(true);
  const setTab = useCallback(
    (next: InspectorTab, persist = true) => {
      storeTab(next, persist);
      setStepsSelected(false);
      onTabChange?.(next);
    },
    [onTabChange, storeTab],
  );
  const mobilePanel = useMemo<MobilePanel | undefined>(
    () =>
      stacked
        ? {
            stepsSelected,
            onSelectSteps: () => setStepsSelected(true),
          }
        : undefined,
    [stacked, stepsSelected],
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
  const roomForRequest = Boolean(expandedRequest) && tab === 'network' && !stacked && !collapsed;
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
  }, [roomForRequest, setInspectorHeight]);

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
      setTab(error.kind, false);
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
      setPageUrl(stepPermalink(location.href, index));
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
        setPageUrl(url);
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
      tracks: defaults.tracks,
      tabOrder: defaults.tabs,
    };
  }, [
    defaults.tabs,
    defaults.tracks,
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

  // Client plugins (src/client/plugins/): one context per plugin for this replay; their actions and panel entries are
  // More-menu items (bar actions are header buttons on desktop), their settings close the menu, open panels draw in a drawer.
  const pluginContexts = usePluginContexts(bundle, player);
  usePluginShortcuts(pluginContexts);
  const pluginMenu = usePluginMenu(pluginContexts, mobile);
  // Memoised so the (memo) header does not re-render on inspector tab switches.
  // why: the recording picker stays in More so the top bar keeps room for the view and layout switches.
  const hasKeyboard = useHasKeyboard();
  const headerMenuItems = useMemo<TopbarMenuItem[]>(
    () => [
      sharedPlayer
        ? {
            label: 'Add a recording',
            icon: <PlusIcon aria-hidden="true" />,
            onSelect: () => setPickerOpen(true),
            testId: 'compare-with',
          }
        : {
            label: 'Compare with…',
            icon: <Columns2Icon aria-hidden="true" />,
            onSelect: () => setPickerOpen(true),
            testId: 'compare-with',
          },
      ...pluginMenu.items,
      ...(betaMalleable()
        ? [{ label: 'Plugin workshop', icon: <PuzzleIcon aria-hidden="true" />, onSelect: openWorkshop, testId: 'malleable-open' }]
        : []),
      // why: only where a keyboard can press them (useHasKeyboard): never on a touch screen without one.
      ...(!hasKeyboard
        ? []
        : [
            {
              label: 'Keyboard shortcuts',
              icon: <AnimatedIcon name="keyboard" />,
              onSelect: actions.openShortcuts,
              shortcut: shortcutLabel('shortcuts'),
              ariaKeyshortcuts: 'Shift+?',
              section: 'after-settings' as const,
            },
          ]),
    ],
    [actions.openShortcuts, hasKeyboard, pluginMenu.items, sharedPlayer],
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

  const views = switcherViews(pageViews());
  const viewChoice: ViewChoice = { views, current: page.view.id, onSelect: page.select, onReset: layout.reset };
  useWindowKeydown((event) => {
    if (event.defaultPrevented || shortcutsOpen || comparisonContext) return;
    const action = shortcutFor(event, event.target instanceof HTMLElement ? event.target : null);
    if (action !== 'next-view' && action !== 'previous-view') return;
    event.preventDefault();
    const next = cycleView(views, page.view.id, action === 'next-view' ? 1 : -1);
    if (next) page.select(next.id);
  });
  const quietPlaying = useQuietPlaying(player, defaults.chrome === 'quiet');
  const showRail = bundle.steps.length > 0 && defaults.steps !== 'hidden';

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
          return setCollapsed(hidden ? false : !collapsedRef.current, !hidden);
        case 'switch-captions':
          return actions.switchCaptions();
        case 'add-comment':
          return startComment.current?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions, hidden, player, setCollapsed]);

  const viewer = (
    <ViewerContext.Provider value={actions}>
      <main
        ref={shell}
        className="app-shell"
        data-mobile={mobile || undefined}
        data-tab={stacked && stepsSelected ? 'steps' : tab}
        data-inspector-collapsed={collapsed || undefined}
        data-inspector-hidden={hidden || undefined}
        data-profile={profile?.id}
        data-view={page.view.id}
        data-chrome={defaults.chrome === 'quiet' ? 'quiet' : undefined}
        data-playing={quietPlaying || undefined}
        style={{ '--inspector-height': inspectorRow(hidden, collapsed && !mobile, inspectorHeight) } as CSSProperties}
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
          menu={menu}
          menuSettings={comparisonContext ? null : <ViewMenuItems {...viewChoice} showReset={false} />}
          menuTail={<ResetViewItem onReset={layout.reset} />}
          {...(titleMenu ? { titleMenu } : {})}
          {...(titleFrom ? { titleFrom } : {})}
          {...(backHref ? { backHref } : {})}
          {...(title ? { title } : {})}
          {...(prefix ? { prefix } : {})}
          {...(headerStatus ? { status: headerStatus } : {})}
          {...(suite ? { suite } : {})}
          leadingActions={headerActions}
          hasEdits={Boolean(edited)}
        />
        <div
          ref={workspace}
          className={`workspace ${showRail ? '' : 'no-steps'}`}
          data-rail-collapsed={(railCollapsed && bundle.steps.length > 0) || undefined}
          style={stepsWidth ? ({ '--steps-width': `${stepsWidth}px` } as CSSProperties) : undefined}
        >
          <section ref={playerRegion} className="player-region" aria-label="Replay">
            {defaults.headline.length ? (
              <Suspense fallback={null}>
                <ViewHeadline
                  ids={defaults.headline}
                  view={page.view.id}
                  bundle={bundle}
                  openTab={openFeaturePanel}
                  onComment={() => startComment.current?.()}
                  compareSummary={compareSummary}
                />
              </Suspense>
            ) : null}
            <div className="stage-wrap">
              {stage ?? <PlayerStage />}
              {/* why: a comparison's stage draws the step caption on its focused tile's frame (CompareTile.tsx). */}
              {effects?.captions.length ? (
                <EditCaption captions={effects.captions} />
              ) : captions && bundle.steps.length > 0 && !stage ? (
                <StepCaption />
              ) : null}
              <SkipIndicator />
              {speedHud ? <SpeedHud key={speedHud.id} speed={speedHud.speed} /> : null}
              <FullscreenButton region={playerRegion} />
            </div>
            <Transport />
          </section>
          {showRail && !stacked ? (
            <>
              <RailSplit
                workspace={workspace}
                width={stepsWidth}
                onWidthChange={setStepsWidth}
                collapsed={railCollapsed}
                onCollapsedChange={setRailCollapsed}
              />
              <StepRail />
              {railCollapsed ? <RailEdgeTab onOpen={() => setRailCollapsed(false)} /> : null}
            </>
          ) : null}
        </div>
        {stacked || hidden ? null : (
          <InspectorSplit
            shell={shell}
            storageKey={viewSettingKey(page.view.id, 'dock-height')}
            height={inspectorHeight}
            onHeightChange={setInspectorHeight}
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
          />
        )}
        {hidden ? (
          <ShowDetails onShow={() => setCollapsed(false, false)} />
        ) : (
          <Inspector
            bundle={bundle}
            sourceBundle={sourceBundle}
            timeline={timeline}
            tab={tab}
            expandedRequest={expandedRequest}
            collapse={inspectorCollapse}
            {...(mobilePanel ? { mobile: mobilePanel } : {})}
            compare={inspectorScope || inspectorPeers ? { scope: inspectorScope, peers: inspectorPeers } : undefined}
          />
        )}
        <StepAnnouncer />
        {pluginMenu.drawer}
        {betaMalleable() ? (
          <Suspense fallback={null}>
            <MalleableHost bundle={bundle} player={player} />
          </Suspense>
        ) : null}
        <ShortcutSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        {pickerOpen ? (
          <Suspense fallback={null}>
            <ComparePicker
              base={bundle.meta}
              exclude={comparing ?? [bundle.meta.id]}
              open
              onOpenChange={setPickerOpen}
              onPick={(id) => {
                setPickerOpen(false);
                if (onCompareWith) onCompareWith(id);
                else compareWith(bundle.meta.id, id, compareLayoutFor(bundle, suiteProfile));
              }}
            />
          </Suspense>
        ) : null}
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
  menuSettings,
  menuTail,
  pluginActions,
  backHref,
  titleMenu,
  titleFrom,
  leadingActions,
  hasEdits = false,
}: {
  bundle: ReplayBundle;
  /** Before the built-in icon actions (a comparison's layout switch). */
  leadingActions?: ReactNode;
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
  menuSettings?: ReactNode;
  menuTail?: ReactNode;
  menuItems: TopbarMenuItem[];
  backHref?: string;
}) {
  // The chip is for explicit outcomes only (the suite's run status). Raw error counts are details: they live
  // in the Console and Network rows, not in the header.
  const shared = {
    title: title ?? bundle.meta.title,
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
        menuSettings={menuSettings}
        menuTail={menuTail}
        hasEdits={hasEdits}
        leadingActions={leadingActions}
        {...shared}
      />
    );
  return (
    <DesktopHeader
      {...shared}
      bundle={bundle}
      suite={suite}
      menu={menu}
      menuItems={menuItems}
      menuFooter={menuFooter}
      menuSettings={menuSettings}
      menuTail={menuTail}
      leadingActions={leadingActions}
      pluginActions={pluginActions}
      hasEdits={hasEdits}
    />
  );
});

/**
 * Phones: the bar keeps the title, Edit and More, so the title keeps its room at 320 px. Details, the copy-link choices,
 * Compare and the downloads live in More; details open as a bottom sheet headed by the full title, which the bar cuts.
 */
function PhoneHeader({
  bundle,
  suite,
  menuItems,
  hasEdits = false,
  leadingActions,
  ...props
}: {
  bundle: ReplayBundle;
  hasEdits?: boolean;
  leadingActions: ReactNode;
  suite: SuiteDetails | undefined;
  /** Recording actions, with comparison first and keyboard utilities after settings. */
  menuItems: TopbarMenuItem[];
  menu: ReactNode;
  menuFooter: ReactNode;
  menuSettings?: ReactNode;
  menuTail?: ReactNode;
  title: string;
  titleId: string;
  prefix?: string;
  status?: ReactNode;
  backHref?: string;
  titleMenu?: ReactNode;
  titleFrom?: string;
}) {
  const download = useDownloadMenu(bundle.meta);
  const player = usePlayer();
  const { steps } = useViewer();
  const [details, setDetails] = useState(false);
  const detailsItem: TopbarMenuItem = {
    label: 'Replay details',
    icon: <AnimatedIcon name="info" />,
    onSelect: () => setDetails(true),
    testId: 'replay-details',
  };
  return (
    <>
      <Topbar
        {...props}
        compact
        appearanceInMenu
        menuItems={[
          ...menuItems.filter((item) => item.testId === 'compare-with'),
          detailsItem,
          ...copyLinkItems(player, steps, suite?.href),
          ...menuItems.filter((item) => item.testId !== 'compare-with'),
          ...download.items,
        ]}
        actions={
          <>
            <ActionsBar
              actions={{
                'core:compare': leadingActions,
                'core:edit': editingEnabled() ? <EditButton id={bundle.meta.id} hasEdits={hasEdits} /> : null,
              }}
            />
            {download.progress}
          </>
        }
      />
      <ReplayInfoButton bundle={bundle} suite={suite} sheet title={props.title} open={details} onOpenChange={setDetails} />
    </>
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

/** The layout two recordings open in: the one of the view the page will be in once it compares. */
function compareLayoutFor(bundle: ReplayBundle, suiteProfile: string | undefined) {
  return viewDefaults(resolvePageView({ search: location.search, replay: bundle, suiteProfile, recordings: 2 })).layout;
}

/** The dock's grid row: none while the view hides it, the tab row while folded, else its height. */
function inspectorRow(hidden: boolean, folded: boolean, height: number) {
  if (hidden) return '0px';
  return folded ? 'var(--inspector-folded-height)' : `${height}px`;
}

/** A view that hides the inspector (Walkthrough) leaves this at the bottom edge; it opens the panel for this visit. */
function ShowDetails({ onShow }: { onShow: () => void }) {
  return (
    <button type="button" className="show-details" onClick={onShow} data-testid="show-details">
      Show details
    </button>
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
    setPageUrl(url);
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

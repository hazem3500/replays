import './editor.css';

import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  EllipsisIcon,
  CaptionsIcon,
  MousePointer2Icon,
  CheckIcon,
  ChevronDownIcon,
  EyeOffIcon,
  FastForwardIcon,
  HourglassIcon,
  Redo2Icon,
  ScissorsIcon,
  Undo2Icon,
  ZoomInIcon,
  PlusIcon,
  MapPinIcon,
  FileVideoCameraIcon,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Hint, IconButton } from '@/components/icon-button.tsx';
import { Button } from '@/components/ui/button.tsx';

import {
  EMPTY_EDITS,
  editListOf,
  editTimeline,
  isEmptyEdits,
  MAX_HIGHLIGHTS,
  type ReplayEdits,
  type StoredReplayEdits,
} from '../../shared/edits.ts';
import {
  clicksOf,
  IDENTITY_TIME,
  playbackEffects,
  proposeStepCaptions,
  proposeZoomRegions,
  SPEED_RATES,
  ZOOM_SCALES,
} from '../../shared/effects.ts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { EditCaption } from '../edit-caption.tsx';
import type { Speed } from '../player.ts';
import { BlurOverlay } from './BlurOverlay.tsx';
import { EffectLanes } from './EffectLanes.tsx';
import { formatClock, type ReplayBundle } from '../../shared/replay.ts';
import { EditsConflictError, EditsUnavailableError, editsQuery, type LoadedEdits, saveEdits } from '../edits.ts';
import { collectErrors } from '../issues.ts';
import { MOBILE_QUERY, useMediaQuery } from '../media.ts';
import { navigate } from '../navigation.ts';
import { PlayerContext, ReplayController, usePlayerState, usePlayhead, useViewport } from '../player.ts';
import { replayHref } from '../route.ts';
import { nextStepIndex, previousStepIndex } from '../timeline.ts';
import { notify } from '../toast.ts';
import { Topbar, type TopbarMenuItem } from '../Topbar.tsx';
import { ViewerContext, type ViewerActions } from '../viewer/context.ts';
import { initialPanelHeight, InspectorResizer, type PanelSize } from '../viewer/Inspector.tsx';
import { PlayerStage } from '../viewer/Transport.tsx';
import {
  addCut,
  canRedo,
  canUndo,
  cutRange,
  editorReducer,
  editorShortcutFor,
  initialEditorState,
  isDirty,
  leavesSomething,
  removeCut,
  savedAgo,
  type Selection,
  type EditorAction,
  setTrimEdge,
  trimOf,
  clearTrim,
  waitSuggestions,
  addEffect,
  addPointHighlight,
  addPeriodHighlight,
  type EffectKind,
  effectList,
  NEW_EFFECT_MS,
  removeEffect,
  removeHighlight,
  updateHighlight,
  updateEffect,
  withEffectList,
} from './state.ts';
import { handOff } from './handoff.ts';
import { cssVars } from '../lib/css-vars.ts';
import { editorHint } from './hint.ts';
import { Timeline } from './Timeline.tsx';
import { CursorInspector } from './CursorInspector.tsx';
import { EditorExport } from './EditorExport.tsx';
import { MobileInspector, MobileAddToolbar, mobileTimelineObjects } from './MobileInspector.tsx';
import { ThemeSwitch } from '../theme.tsx';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';
/** Quiet time after the last change before it is saved. */
const AUTOSAVE_MS = 700;

type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed' | 'unavailable';
/** Retries after a failed save: 2 s, 4 s, 8 s… up to RETRY_MAX_MS. */
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30_000;

/** The timeline dock: resized from its top edge like the viewer's diagnostics panel, kept under its own key. */
const DEFAULT_DOCK_HEIGHT = 168;
const DOCK_SIZE: PanelSize = {
  storageKey: 'replays-editor-dock-height',
  variable: '--dock-height',
  // Playback, ruler, clip and a quiet hint; effect tracks scroll when the dock is short.
  min: 148,
  max: () => Math.max(148, Math.round(window.innerHeight * 0.65)),
  label: 'Resize timeline',
};

/**
 * Edit mode (`/r/<id>/edit`), in the spirit of Screen Studio: a large preview, one control row, and one wide
 * timeline that holds every edit (src/client/editor/Timeline.tsx). Everything is direct manipulation: drag the clip's
 * edges to trim, drag across the clip to select and C to cut, drag a cut's edges or remove it from its ×. "Remove
 * waits" first shows the waits it found on the track; Enter applies them all. Playback previews the result live (cuts
 * are skipped, it stops at the trim end). Changes save on their own (a quiet "Saved"); View replay returns to the viewer.
 * Edits are a non-destructive list next to the replay (src/shared/edits.ts).
 */
export function Editor({ bundle, loaded }: { bundle: ReplayBundle; loaded: LoadedEdits }) {
  const id = bundle.meta.id;
  const player = useMemo(() => new ReplayController(bundle), [bundle]);
  const duration = player.duration;
  const [state, dispatch] = useReducer(editorReducer, loaded.stored, (stored: StoredReplayEdits) => initialEditorState(editListOf(stored)));
  const [etag, setEtag] = useState(loaded.etag);
  const [stored, setStored] = useState(loaded.stored);
  const [status, setStatus] = useState<SaveStatus>('idle');
  /** Failed saves in a row (the retry backoff), and the last failure's reason (the indicator's tooltip). */
  const [failures, setFailures] = useState(0);
  const [failure, setFailure] = useState('');
  const [conflict, setConflict] = useState<LoadedEdits>();
  const [suggesting, setSuggesting] = useState(false);
  const [showEmptyTracks, setShowEmptyTracks] = useState(false);
  const [cursorOpen, setCursorOpen] = useState(false);
  const mobileMore = useRef<HTMLDetailsElement>(null);
  const focusCaption = useRef(false);
  const [mobileTrimOpen, setMobileTrimOpen] = useState(false);
  const mobileReturnFocus = useRef<HTMLElement | null>(null);
  const [blurPlacement, setBlurPlacement] = useState<{ from: number; to: number }>();
  const [note, say] = useNote();
  const mobile = useMediaQuery(MOBILE_QUERY);
  const shell = useRef<HTMLElement>(null);
  const [dockHeight, setDockHeight] = useState(() => initialPanelHeight(DOCK_SIZE, DEFAULT_DOCK_HEIGHT));
  const queryClient = useQueryClient();
  const edits = state.present;
  const timeline = useMemo(() => editTimeline(edits, duration), [edits, duration]);
  const dirty = isDirty(state);
  const errors = useMemo(() => collectErrors(bundle), [bundle]);
  const suggestions = useMemo(
    () => (suggesting ? waitSuggestions(edits, bundle.steps, duration) : []),
    [bundle.steps, duration, edits, suggesting],
  );

  // Latest values for listeners that live as long as the player or the page.
  const live = useRef({ timeline, state, dirty, etag, conflict, suggestions });
  useEffect(() => {
    live.current = { timeline, state, dirty, etag, conflict, suggestions };
  }, [timeline, state, dirty, etag, conflict, suggestions]);

  // The preview draws the effects on the original timeline it plays (zoom, blur; captions over the stage).
  const previewEffects = useMemo(() => playbackEffects(edits, IDENTITY_TIME(duration), bundle.events), [bundle.events, duration, edits]);
  useEffect(() => player.setEffects(previewEffects), [player, previewEffects]);
  // Placing a blur box: the zoom holds at 1× so the box sits on the page as recorded.
  useEffect(
    () => player.setZoomSuspended(Boolean(blurPlacement) || state.selection?.kind === 'blur'),
    [blurPlacement, player, state.selection],
  );
  const speedsRef = useRef(edits.speeds);
  useEffect(() => {
    speedsRef.current = edits.speeds;
  }, [edits.speeds]);

  // Live preview: playback skips cuts, stops at the trim end, and plays speed-ups at their rate.
  useEffect(
    () =>
      player.subscribeTime(() => {
        const { timeline: current } = live.current;
        if (player.getState().status !== 'playing' || player.isScrubbing()) return;
        const time = player.getTime();
        const rate = (speedsRef.current?.find((item) => time >= item.from && time < item.to)?.rate ?? 1) as Speed;
        if (player.getState().speed !== rate) player.setSpeed(rate);
        const range = current.removed.find((item) => time >= item.from && time < item.to);
        if (!range) return;
        if (range.to >= player.duration - 1) {
          player.pause();
          player.seek(range.from);
        } else player.seek(range.to);
      }),
    [player],
  );

  const playPause = useCallback(() => {
    const { timeline: current } = live.current;
    if (player.getState().status !== 'playing') {
      // From a trimmed-off end (or the very end), play the edited version from its start.
      const time = player.getTime();
      const tail = current.removed.at(-1);
      const atEnd = (tail && tail.to >= player.duration - 1 && time >= tail.from - 1) || time >= player.duration - 1;
      if (atEnd || current.isRemoved(time)) player.seek(current.toOriginal(atEnd ? 0 : current.toEdited(time)));
    }
    player.playPause();
  }, [player]);

  const change = useCallback((next: ReplayEdits, select?: Selection) => {
    dispatch({ type: 'change', edits: next, ...(select ? { select } : {}) });
  }, []);

  /* ---------- Saving: automatic, quiet ---------- */

  const saving = useRef<Promise<boolean> | undefined>(undefined);
  const save = useCallback(async (): Promise<boolean> => {
    if (saving.current) await saving.current;
    const { state: current, dirty: changed, etag: version, conflict: blocked } = live.current;
    if (!changed) return true;
    if (blocked) return false;
    if (!leavesSomething(current.present, duration)) return false;
    const run = (async () => {
      setStatus('saving');
      try {
        const result = await saveEdits(id, current.present, version);
        live.current.etag = result.etag;
        setEtag(result.etag);
        setStored(result.stored);
        dispatch({ type: 'saved', edits: editListOf(result.stored) });
        queryClient.setQueryData(editsQuery(id).queryKey, result);
        setStatus('saved');
        setFailures(0);
        return true;
      } catch (error) {
        if (error instanceof EditsConflictError) {
          live.current.conflict = error.current;
          setConflict(error.current);
          setStatus('idle');
        } else {
          // A detail, not a headline: the indicator says "Not saved · Retry" and retries on its own.
          setStatus(error instanceof EditsUnavailableError ? 'unavailable' : 'failed');
          setFailure(error instanceof Error ? error.message : String(error));
          setFailures((count) => count + 1);
        }
        return false;
      }
    })();
    saving.current = run;
    try {
      return await run;
    } finally {
      saving.current = undefined;
    }
  }, [duration, id, queryClient]);

  // Autosave a moment after the last change (one drag is one change: it saves when the drag settles).
  // After a failure it retries with backoff (a server without the edits API is not retried: it cannot work there).
  useEffect(() => {
    if (!dirty || conflict || status === 'unavailable' || status === 'saving') return;
    const wait = status === 'failed' ? Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1)) : AUTOSAVE_MS;
    const timer = window.setTimeout(() => void save(), wait);
    return () => window.clearTimeout(timer);
  }, [conflict, dirty, edits, failures, save, status]);

  // Leaving without Done (browser Back, a key on another route): the pending change still saves, and the viewer
  // still resumes at the playhead.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(
    () => () => {
      const { timeline: current, dirty: pending } = live.current;
      const time = player.getTime();
      handOff(id, time >= player.duration - 1 || current.toEdited(time) >= current.duration - 1 ? 0 : current.toEdited(time));
      if (pending) void saveRef.current();
    },
    [id, player],
  );

  /** Leaves edit mode for `href` once the latest change is saved (it stays if saving fails). */
  const leave = useCallback(
    async (href: string) => {
      if (live.current.dirty && !(await save()) && live.current.dirty) {
        // Asked for (Done, back): one quiet note, and the edits stay on screen.
        say('Not saved yet · the edits stay here until they can be saved');
        return;
      }
      // The viewer resumes where the playhead is, on the edited timeline, and plays the result.
      const { timeline: current } = live.current;
      const time = player.getTime();
      handOff(id, time >= player.duration - 1 || current.toEdited(time) >= current.duration - 1 ? 0 : current.toEdited(time));
      navigate(href);
    },
    [id, player, save, say],
  );

  // A link out of edit mode (the back arrow) waits for the save; closing the tab with unsaved changes asks first.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!live.current.dirty || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.target || link.origin !== location.origin) return;
      event.preventDefault();
      event.stopPropagation();
      void leave(link.href);
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (live.current.dirty) event.preventDefault();
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [leave]);

  /* ---------- Actions ---------- */

  const actions = useMemo(
    () => ({
      trimStart: () => change(setTrimEdge(live.current.state.present, 'start', player.getTime(), duration), { kind: 'trim' }),
      trimEnd: () => change(setTrimEdge(live.current.state.present, 'end', player.getTime(), duration), { kind: 'trim' }),
      /** C / S: cut the selected range, else a second at the playhead. */
      cut: () => {
        const { present, selection } = live.current.state;
        const added =
          selection?.kind === 'range'
            ? cutRange(present, selection.from, selection.to, duration)
            : addCut(present, player.getTime(), duration);
        if (added) change(added.edits, { kind: 'cut', id: added.id });
        else say('Nothing to cut here · the playhead is outside the clip');
      },
      /** W: show the waits it would cut; again (or Enter) applies them. */
      removeWaits: () => {
        if (live.current.suggestions.length) {
          applySuggestions();
          return;
        }
        if (!waitSuggestions(live.current.state.present, bundle.steps, duration).length) {
          say(bundle.steps.some((step) => step.kind === 'wait') ? 'No waits left to cut' : 'No wait steps in this replay');
          return;
        }
        setSuggesting(true);
      },
      deleteSelection: () => {
        const { present, selection } = live.current.state;
        if (selection?.kind === 'trim') change(clearTrim(present));
        else if (selection?.kind === 'cut') change(removeCut(present, selection.id));
        else if (selection?.kind === 'highlight') change(removeHighlight(present, selection.id));
        else if (selection && selection.kind !== 'range') change(removeEffect(present, selection.kind, selection.id));
      },
      pointHighlight: () => {
        const at = player.getTime();
        const present = live.current.state.present;
        if (
          !present.highlights?.some((highlight) => highlight.kind === 'point' && highlight.at === at) &&
          (present.highlights?.length ?? 0) >= MAX_HIGHLIGHTS
        ) {
          say(`A replay can have up to ${MAX_HIGHLIGHTS} highlights`);
          return;
        }
        if (live.current.timeline.isRemoved(at)) {
          say('Move to a kept moment to add a highlight');
          return;
        }
        const added = addPointHighlight(present, at, duration);
        change(added.edits, { kind: 'highlight', id: added.id });
      },
      periodHighlight: () => {
        const { present, selection } = live.current.state;
        if ((present.highlights?.length ?? 0) >= MAX_HIGHLIGHTS) {
          say(`A replay can have up to ${MAX_HIGHLIGHTS} highlights`);
          return;
        }
        if (selection?.kind !== 'range') {
          say('Select a stretch on the clip first');
          return;
        }
        const bounds = trimOf(present, duration);
        const from = Math.max(bounds.start, selection.from);
        const to = Math.min(bounds.end, selection.to);
        if (live.current.timeline.toEdited(to) <= live.current.timeline.toEdited(from)) {
          say('Select a stretch that remains in the edited replay');
          return;
        }
        const added = addPeriodHighlight(present, from, to, duration);
        if (added) change(added.edits, { kind: 'highlight', id: added.id });
        else say('Select at least 0.1 seconds of the clip');
      },
      /**
       * Z / F / B / T: an effect over the selected range, else at the playhead. Zoom with nothing selected zooms in on
       * every click; captions with none yet come from the steps.
       */
      effect: (kind: EffectKind) => {
        const { present, selection } = live.current.state;
        const range = selection?.kind === 'range' ? selection : undefined;
        if (kind === 'blur') {
          player.pause();
          const from = range?.from ?? player.getTime();
          setBlurPlacement({ from, to: range?.to ?? Math.min(duration, from + NEW_EFFECT_MS) });
          return;
        }
        setBlurPlacement(undefined);
        if (!range && kind === 'zoom') {
          const regions = proposeZoomRegions(clicksOf(bundle.events), duration, present.zooms ?? [], undefined, (index) =>
            nextEffectId(present, 'zoom', index),
          );
          if (regions.length) {
            change(withEffectList(present, 'zoom', [...(present.zooms ?? []), ...regions]));
            return;
          }
        }
        if (!range && kind === 'caption' && !present.captions?.length) {
          const captions = proposeStepCaptions(bundle.steps, duration);
          if (captions.length) {
            change(withEffectList(present, 'caption', captions));
            return;
          }
        }
        const time = player.getTime();
        const added = range
          ? addEffect(present, kind, range.from, range.to, duration)
          : addEffect(present, kind, time, time + NEW_EFFECT_MS, duration);
        if (added) change(added.edits, { kind, id: added.id });
        else say(kind === 'speed' ? 'Already sped up here' : 'No room here for another one');
      },
    }),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- applySuggestions reads only refs
    [bundle.steps, change, duration, player, say],
  );

  function applySuggestions() {
    const { state: current, suggestions: found } = live.current;
    setSuggesting(false);
    if (!found.length) return;
    change({ ...current.present, cuts: [...current.present.cuts, ...found] });
  }

  // Keys (shown in the tooltips).
  useEffect(() => {
    const seekBy = (delta: number) => player.seek(player.getTime() + delta);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const action = editorShortcutFor(event, target, IS_MAC);
      if (!action) return;
      // A slider under the keyboard (a trim edge) owns its arrows.
      if ((action.startsWith('seek-') || action.startsWith('nudge-')) && target?.getAttribute('role') === 'slider') return;
      event.preventDefault();
      switch (action) {
        case 'undo':
          return dispatch({ type: 'undo' });
        case 'redo':
          return dispatch({ type: 'redo' });
        case 'save':
          return void save();
        case 'play-pause':
          return playPause();
        case 'seek-back':
          return seekBy(-1000);
        case 'seek-forward':
          return seekBy(1000);
        case 'seek-back-long':
          return seekBy(-5000);
        case 'seek-forward-long':
          return seekBy(5000);
        case 'nudge-back':
          return seekBy(-100);
        case 'nudge-forward':
          return seekBy(100);
        case 'previous-step': {
          const index = previousStepIndex(bundle.steps, player.getTime());
          if (index >= 0) player.seek(bundle.steps[index]!.at);
          return;
        }
        case 'next-step': {
          const index = nextStepIndex(bundle.steps, player.getTime());
          if (index >= 0) player.seek(bundle.steps[index]!.at);
          return;
        }
        case 'trim-start':
          return actions.trimStart();
        case 'trim-end':
          return actions.trimEnd();
        case 'add-cut':
          return actions.cut();
        case 'remove-waits':
          return actions.removeWaits();
        case 'zoom':
        case 'speed':
        case 'blur':
        case 'caption':
          return actions.effect(action);
        case 'highlight':
          return actions.pointHighlight();
        case 'apply':
          if (live.current.suggestions.length) applySuggestions();
          else if (live.current.state.selection?.kind === 'range') actions.cut();
          return;
        case 'delete':
          return actions.deleteSelection();
        case 'deselect':
          setMobileTrimOpen(false);
          setBlurPlacement(undefined);
          setSuggesting(false);
          return dispatch({ type: 'select', selection: undefined });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- applySuggestions reads only refs
  }, [actions, bundle.steps, player, save, playPause]);

  useEffect(() => {
    document.title = `Edit · ${bundle.meta.title} · replays`;
  }, [bundle.meta.title]);

  const viewerActions = useMemo<ViewerActions>(
    () => ({
      steps: bundle.steps,
      errors,
      setTab: () => undefined,
      setExpandedRequest: () => undefined,
      goToStep: (index) => {
        const step = bundle.steps[index];
        if (step) player.seek(step.at);
      },
      goToNextStep: () => undefined,
      goToPreviousStep: () => undefined,
      jumpToError: (error) => player.seek(error.at),
      goToNextError: () => undefined,
      goToPreviousError: () => undefined,
      copyLink: () => undefined,
      switchFullscreen: () => undefined,
      openShortcuts: () => undefined,
      notify: (message) => notify(message),
      captions: false,
      switchCaptions: () => undefined,
    }),
    [bundle.steps, errors, player],
  );

  const menuItems = useMemo<TopbarMenuItem[]>(
    () => [
      ...(mobile
        ? [
            {
              label: 'Undo',
              icon: <Undo2Icon aria-hidden="true" />,
              onSelect: () => dispatch({ type: 'undo' }),
              disabled: !canUndo(state),
              shortcut: `${MOD}Z`,
              testId: 'undo',
            },
            {
              label: 'Redo',
              icon: <Redo2Icon aria-hidden="true" />,
              onSelect: () => dispatch({ type: 'redo' }),
              disabled: !canRedo(state),
              shortcut: IS_MAC ? '⇧⌘Z' : 'Ctrl+Y',
              testId: 'redo',
            },
          ]
        : []),
      {
        label: 'View original',
        icon: <FileVideoCameraIcon aria-hidden="true" />,
        onSelect: () => void leave(`${replayHref(id)}?original=1`),
        testId: 'editor-view-original',
      },
      {
        label: 'Remove waits',
        icon: <HourglassIcon aria-hidden="true" />,
        onSelect: actions.removeWaits,
        shortcut: 'W',
        testId: 'remove-waits-item',
      },
      {
        label: 'Reset all edits',
        icon: <AnimatedIcon name="rotate-ccw" />,
        onSelect: () => change(EMPTY_EDITS),
        disabled: isEmptyEdits(edits),
        testId: 'reset-edits',
      },
    ],
    [actions.removeWaits, change, edits, id, leave, mobile, state],
  );

  const selection = state.selection;
  // why: opening the untouched clip is UI state; the reducer correctly stores no redundant full-duration trim.
  const mobileSelection: Selection = mobileTrimOpen && !selection ? { kind: 'trim' } : selection;
  const timelineDispatch = (action: EditorAction) => {
    if (mobile && (action.type === 'select' || (action.type === 'change' && action.select))) {
      const selected = action.type === 'select' ? action.selection : action.select;
      setMobileTrimOpen(selected?.kind === 'trim');
      mobileReturnFocus.current = null;
      setCursorOpen(false);
      setBlurPlacement(undefined);
    }
    dispatch(action);
  };
  useEffect(() => {
    if (!mobile || !focusCaption.current || selection?.kind !== 'caption') return;
    const field = document.getElementById('mobile-caption-text');
    if (field instanceof HTMLTextAreaElement) {
      field.focus({ preventScroll: true });
      field.select();
    }
    focusCaption.current = false;
  }, [mobile, selection]);

  const rememberMobileFocus = () => {
    mobileReturnFocus.current =
      document.activeElement instanceof HTMLElement && document.activeElement.matches('button, a, summary, input, textarea, [tabindex]')
        ? document.activeElement
        : null;
  };
  const finishMobileObject = () => {
    let target = mobileReturnFocus.current;
    if (!target?.isConnected || target.closest('.editor-context-panel')) target = null;
    if (!target && selection && 'id' in selection) target = objectFocusTarget(shell.current, selection.id);
    dispatch({ type: 'select', selection: undefined });
    setCursorOpen(false);
    setMobileTrimOpen(false);
    setBlurPlacement(undefined);
    (target ?? shell.current?.querySelector<HTMLElement>('.editor-ruler-seek'))?.focus({ preventScroll: true });
    mobileReturnFocus.current = null;
  };
  const addMobileObject = (kind: EffectKind) => {
    rememberMobileFocus();
    player.pause();
    setCursorOpen(false);
    setMobileTrimOpen(false);
    setBlurPlacement(undefined);
    const at = player.getTime();
    const present = live.current.state.present;
    if (live.current.timeline.isRemoved(at)) {
      say('Choose a kept moment on the timeline first');
      return;
    }
    const existing = effectList(present, kind).find((item) => at >= item.from && at < item.to);
    if (kind === 'caption') focusCaption.current = true;
    if (existing) {
      dispatch({ type: 'select', selection: { kind, id: existing.id } });
      return;
    }
    if (kind === 'blur') {
      actions.effect('blur');
      return;
    }
    const added = addEffect(present, kind, at, Math.min(trimOf(present, duration).end, at + NEW_EFFECT_MS), duration);
    if (added) change(added.edits, { kind, id: added.id });
    else {
      focusCaption.current = false;
      say('No room here · move the playhead earlier');
    }
  };
  const selectMobileRange = () => {
    rememberMobileFocus();
    player.pause();
    setCursorOpen(false);
    setMobileTrimOpen(false);
    setBlurPlacement(undefined);
    const bounds = trimOf(live.current.state.present, duration);
    const from = Math.max(bounds.start, Math.min(player.getTime(), bounds.end - 100));
    dispatch({ type: 'select', selection: { kind: 'range', from, to: Math.min(bounds.end, from + 1000) } });
    player.seek(from);
  };
  const cursorInspector = (
    <CursorInspector
      embedded={!mobile}
      settings={edits.cursor}
      onChange={(cursor) => {
        const { cursor: _previous, ...rest } = live.current.state.present;
        change(cursor ? { ...rest, cursor } : rest);
      }}
      onClose={finishMobileObject}
    />
  );
  const empty = isEmptyEdits(edits);
  const hint = editorHint(selection, suggesting, empty);

  return (
    <PlayerContext.Provider value={player}>
      <ViewerContext.Provider value={viewerActions}>
        <main
          ref={shell}
          className="app-shell editor-shell"
          data-mobile={mobile || undefined}
          data-testid="editor"
          style={mobile ? undefined : cssVars({ '--dock-height': `${dockHeight}px` })}
        >
          {mobile ? (
            <header className="editor-mobile-header">
              <Button variant="ghost" size="icon" aria-label="Back to the replay" onClick={() => void leave(replayHref(id))}>
                <ArrowLeftIcon aria-hidden="true" />
              </Button>
              <div className="editor-mobile-heading">
                <h1 id="replay-title" title={bundle.meta.title}>
                  {bundle.meta.title}
                </h1>
                {conflict ? (
                  <span className="editor-save-state" role="status">
                    Save conflict · choose below
                  </span>
                ) : (
                  <SaveIndicator status={status} dirty={dirty} stored={stored} failure={failure} onRetry={() => void save()} />
                )}
              </div>
              <IconButton label="Undo" disabled={!canUndo(state)} onClick={() => dispatch({ type: 'undo' })} data-testid="undo">
                <Undo2Icon aria-hidden="true" />
              </IconButton>
              <EditorExport meta={bundle.meta} stored={stored} dirty={dirty} saving={status === 'saving'} />
              {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- why: native details is interactive; Escape closes its disclosure from descendant controls. */}
              <details
                ref={mobileMore}
                className="editor-mobile-more"
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && !event.defaultPrevented) {
                    event.preventDefault();
                    if (mobileMore.current) mobileMore.current.open = false;
                    mobileMore.current?.querySelector('summary')?.focus();
                  }
                  if (!event.metaKey && !event.ctrlKey && !event.altKey) event.stopPropagation();
                }}
              >
                <summary aria-label="More editor actions">
                  <EllipsisIcon aria-hidden="true" />
                </summary>
                <div className="editor-mobile-menu" role="group" aria-label="More editor actions">
                  {menuItems
                    .filter((item) => item.testId !== 'undo')
                    .map((item) => (
                      <Button
                        key={item.label}
                        variant="ghost"
                        disabled={item.disabled}
                        data-testid={item.testId}
                        onClick={() => {
                          item.onSelect();
                          if (mobileMore.current) mobileMore.current.open = false;
                          mobileMore.current?.querySelector('summary')?.focus();
                        }}
                      >
                        {item.icon}
                        {item.label}
                      </Button>
                    ))}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (mobileMore.current) mobileMore.current.open = false;
                      mobileMore.current?.querySelector('summary')?.focus();
                      rememberMobileFocus();
                      dispatch({ type: 'select', selection: undefined });
                      setMobileTrimOpen(false);
                      setBlurPlacement(undefined);
                      setCursorOpen(true);
                    }}
                  >
                    <MousePointer2Icon aria-hidden="true" />
                    Cursor options
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (mobileMore.current) mobileMore.current.open = false;
                      mobileMore.current?.querySelector('summary')?.focus();
                      void leave(replayHref(id));
                    }}
                    data-testid="editor-done"
                  >
                    View replay
                  </Button>
                  <ThemeSwitch />
                </div>
              </details>
            </header>
          ) : (
            <Topbar
              title={bundle.meta.title}
              prefix="Edit"
              titleId="replay-title"
              backHref={replayHref(id)}
              backLabel="Back to the replay"
              status={<SaveIndicator status={status} dirty={dirty} stored={stored} failure={failure} onRetry={() => void save()} />}
              menuItems={menuItems}
              alwaysMenu
              actions={
                <>
                  <div className="editor-history" role="group" aria-label="Edit history">
                    <IconButton
                      label="Undo"
                      shortcut={`${MOD}Z`}
                      tooltipSide="bottom"
                      disabled={!canUndo(state)}
                      onClick={() => dispatch({ type: 'undo' })}
                      data-testid="undo"
                    >
                      <Undo2Icon aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label="Redo"
                      shortcut={IS_MAC ? '⇧⌘Z' : 'Ctrl+Y'}
                      tooltipSide="bottom"
                      disabled={!canRedo(state)}
                      onClick={() => dispatch({ type: 'redo' })}
                      data-testid="redo"
                    >
                      <Redo2Icon aria-hidden="true" />
                    </IconButton>
                  </div>
                  <Hint label="Back to the replay, edits applied" side="bottom" align="end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="editor-done"
                      aria-label="View replay"
                      onClick={() => void leave(replayHref(id))}
                      data-testid="editor-done"
                    >
                      View replay
                    </Button>
                  </Hint>
                  <EditorExport meta={bundle.meta} stored={stored} dirty={dirty} saving={status === 'saving'} />
                </>
              }
            />
          )}
          <section className="editor-stage" aria-label="Preview">
            <EditorPreviewFrame>
              <PlayerStage />
              <BlurOverlay
                edits={edits}
                selection={selection}
                dispatch={dispatch}
                placing={Boolean(blurPlacement)}
                onCancel={() => setBlurPlacement(undefined)}
                onPlace={(box) => {
                  if (!blurPlacement) return;
                  const added = addEffect(live.current.state.present, 'blur', blurPlacement.from, blurPlacement.to, duration, box);
                  if (added) change(added.edits, { kind: 'blur', id: added.id });
                  else say('Choose a position inside the replay to add a blur');
                  setBlurPlacement(undefined);
                }}
              />
              {previewEffects.captions.length ? <EditCaption captions={previewEffects.captions} /> : null}
            </EditorPreviewFrame>
            {!mobile ? (
              <aside className="editor-presentation" aria-label="Replay presentation">
                <header className="editor-presentation-header">
                  <h2>Appearance</h2>
                  <p>Applies to the whole replay</p>
                </header>
                {cursorInspector}
              </aside>
            ) : null}
          </section>
          {mobile ? null : <InspectorResizer shell={shell} height={dockHeight} onCommit={setDockHeight} size={DOCK_SIZE} />}
          <section className="editor-dock" aria-label={mobile ? 'Editing tools' : 'Timeline'}>
            {mobile ? (
              <>
                <MobilePlayback onSwitch={playPause} original={timeline.originalDuration} edited={timeline.duration} />
                {suggesting && suggestions.length ? (
                  <div className="editor-suggest" role="status" data-testid="wait-suggestions">
                    {suggestions.length} waits found
                    <Button variant="secondary" onClick={applySuggestions} data-testid="apply-waits">
                      Remove all
                    </Button>
                    <Button variant="ghost" onClick={() => setSuggesting(false)}>
                      Dismiss
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="editor-bar" role="group" aria-label="Playback and tools">
                <EditorPlayButton onSwitch={playPause} />
                <EditorClock />
                <span className="editor-bar-divider" aria-hidden="true" />
                <IconButton
                  label={selection?.kind === 'range' ? 'Cut the selection' : 'Cut a second at the playhead'}
                  shortcut="C"
                  onClick={actions.cut}
                  data-testid="add-cut"
                >
                  <ScissorsIcon aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={suggesting ? 'Remove the waits found' : 'Find waits to remove'}
                  shortcut="W"
                  onClick={actions.removeWaits}
                  data-testid="remove-waits"
                  aria-pressed={suggesting}
                >
                  <HourglassIcon aria-hidden="true" />
                </IconButton>
                <IconButton label="Highlight this moment" shortcut="M" onClick={actions.pointHighlight} data-testid="add-point-highlight">
                  <MapPinIcon aria-hidden="true" />
                </IconButton>
                <span className="editor-bar-divider" aria-hidden="true" />
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button size="sm" variant="ghost" className="editor-add-effect" data-testid="add-effect" />}>
                    <PlusIcon aria-hidden="true" /> Add <ChevronDownIcon aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" className="w-auto min-w-52" aria-label="Add to timeline">
                    <DropdownMenuItem onClick={() => actions.effect('zoom')} data-testid="add-zoom">
                      <ZoomInIcon aria-hidden="true" /> Zoom on clicks <DropdownMenuShortcut>Z</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => actions.effect('speed')} data-testid="add-speed">
                      <FastForwardIcon aria-hidden="true" /> Speed up <DropdownMenuShortcut>F</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => actions.effect('blur')} data-testid="add-blur">
                      <EyeOffIcon aria-hidden="true" /> Blur an area <DropdownMenuShortcut>B</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => actions.effect('caption')} data-testid="add-caption">
                      <CaptionsIcon aria-hidden="true" /> Captions <DropdownMenuShortcut>T</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={actions.periodHighlight} data-testid="add-period-highlight">
                      <ScissorsIcon aria-hidden="true" /> Highlight selection
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      checked={showEmptyTracks}
                      onCheckedChange={setShowEmptyTracks}
                      closeOnClick
                      data-testid="show-empty-tracks"
                    >
                      Show empty tracks
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <EffectControls edits={edits} selection={selection} change={change} />
                <HighlightControls edits={edits} selection={selection} duration={duration} change={change} />
                <div className="editor-bar-end">
                  {suggesting && suggestions.length ? (
                    <span className="editor-suggest" role="status" data-testid="wait-suggestions">
                      {suggestions.length} {suggestions.length === 1 ? 'wait' : 'waits'} found
                      <Button size="sm" variant="secondary" onClick={applySuggestions} data-testid="apply-waits">
                        Remove all <kbd>↵</kbd>
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setSuggesting(false)}>
                        Dismiss
                      </Button>
                    </span>
                  ) : (
                    <Durations original={timeline.originalDuration} edited={timeline.duration} />
                  )}
                </div>
              </div>
            )}
            {conflict ? (
              <div className="editor-conflict" role="status">
                Newer edits by {conflict.stored.updatedBy ?? 'someone'} · {savedAgo(conflict.stored.updatedAt)}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    dispatch({ type: 'load', edits: editListOf(conflict.stored) });
                    setEtag(conflict.etag);
                    setStored(conflict.stored);
                    setConflict(undefined);
                  }}
                >
                  Load theirs
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEtag(conflict.etag);
                    live.current.etag = conflict.etag;
                    live.current.conflict = undefined;
                    setConflict(undefined);
                  }}
                >
                  Keep mine
                </Button>
              </div>
            ) : null}
            <div id="editor-timeline" className="editor-timeline-content" role="group" aria-label="Editable timeline">
              <Timeline
                mobile={mobile}
                duration={duration}
                edits={edits}
                selection={mobile ? mobileSelection : selection}
                dispatch={mobile ? timelineDispatch : dispatch}
                suggestions={suggestions}
                onCutRange={actions.cut}
                lanes={
                  <EffectLanes
                    edits={edits}
                    selection={selection}
                    dispatch={mobile ? timelineDispatch : dispatch}
                    showEmpty={!mobile && showEmptyTracks}
                  />
                }
              />
            </div>
            {mobile ? (
              <>
                <MobileAddToolbar
                  objects={mobileTimelineObjects(edits)}
                  onSelectObject={(object) => {
                    timelineDispatch({ type: 'select', selection: object.selection });
                    mobileReturnFocus.current = shell.current?.querySelector<HTMLElement>('.editor-add-more') ?? null;
                    player.pause();
                    player.seek(object.at);
                    if (object.selection?.kind === 'caption') focusCaption.current = true;
                  }}
                  onTrim={() => {
                    rememberMobileFocus();
                    player.pause();
                    setCursorOpen(false);
                    setMobileTrimOpen(true);
                    setBlurPlacement(undefined);
                    dispatch({ type: 'select', selection: { kind: 'trim' } });
                  }}
                  onCaption={() => addMobileObject('caption')}
                  onBlur={() => addMobileObject('blur')}
                  onZoom={() => addMobileObject('zoom')}
                  more={[
                    { label: 'Speed up', action: () => addMobileObject('speed'), testId: 'add-speed' },
                    {
                      label: selection?.kind === 'range' ? 'Cut selection' : 'Cut at playhead',
                      action: () => {
                        rememberMobileFocus();
                        setCursorOpen(false);
                        setMobileTrimOpen(false);
                        setBlurPlacement(undefined);
                        actions.cut();
                      },
                      testId: 'add-cut',
                    },
                    { label: 'Select a range', action: selectMobileRange, testId: 'select-range' },
                    {
                      label: 'Highlight moment',
                      action: () => {
                        rememberMobileFocus();
                        setCursorOpen(false);
                        setMobileTrimOpen(false);
                        setBlurPlacement(undefined);
                        actions.pointHighlight();
                      },
                      testId: 'add-point-highlight',
                    },
                    {
                      label: 'Cursor options',
                      action: () => {
                        rememberMobileFocus();
                        setMobileTrimOpen(false);
                        setBlurPlacement(undefined);
                        dispatch({ type: 'select', selection: undefined });
                        setCursorOpen(true);
                      },
                    },
                    {
                      label: 'Generate captions from steps',
                      disabled: Boolean(edits.captions?.length),
                      action: () => {
                        const present = live.current.state.present;
                        if (present.captions?.length) return;
                        const captions = proposeStepCaptions(bundle.steps, duration);
                        const first = captions.at(0);
                        if (first) {
                          setCursorOpen(false);
                          setMobileTrimOpen(false);
                          setBlurPlacement(undefined);
                          change(withEffectList(present, 'caption', captions), { kind: 'caption', id: first.id });
                        } else say('No recorded steps to caption');
                      },
                      testId: 'generate-step-captions',
                    },
                    {
                      label: 'Zoom on all clicks',
                      action: () => {
                        rememberMobileFocus();
                        setCursorOpen(false);
                        setMobileTrimOpen(false);
                        setBlurPlacement(undefined);
                        const present = live.current.state.present;
                        const regions = proposeZoomRegions(clicksOf(bundle.events), duration, present.zooms ?? [], undefined, (index) =>
                          nextEffectId(present, 'zoom', index),
                        );
                        const firstRegion = regions.at(0);
                        if (firstRegion)
                          change(withEffectList(present, 'zoom', [...(present.zooms ?? []), ...regions]), {
                            kind: 'zoom',
                            id: firstRegion.id,
                          });
                        else say('No clicks need a zoom');
                      },
                    },
                  ]}
                />
                <MobileInspector
                  edits={edits}
                  selection={mobileSelection}
                  duration={duration}
                  change={change}
                  commands={{
                    onSelectRange: (from, to) => dispatch({ type: 'select', selection: { kind: 'range', from, to } }),
                    onDone: finishMobileObject,
                    onDelete: () => {
                      actions.deleteSelection();
                      mobileReturnFocus.current = shell.current?.querySelector<HTMLElement>('.editor-ruler-seek') ?? null;
                      finishMobileObject();
                    },
                    onCut: actions.cut,
                    onPeriodHighlight: actions.periodHighlight,
                  }}
                  cursorOpen={cursorOpen}
                  placingBlur={Boolean(blurPlacement)}
                  panels={{
                    cursorInspector,
                    effectControls: <EffectControls mobile edits={edits} selection={selection} change={change} />,
                    highlightControls: (
                      <HighlightControls
                        edits={edits}
                        selection={selection}
                        duration={duration}
                        change={change}
                        afterRemove={() => {
                          mobileReturnFocus.current = shell.current?.querySelector<HTMLElement>('.editor-ruler-seek') ?? null;
                          finishMobileObject();
                        }}
                      />
                    ),
                  }}
                />
              </>
            ) : null}
            <p className="editor-hint" data-testid="editor-hint" data-note={note ? '' : undefined}>
              {note ?? hint}
            </p>
            <span className="sr-only" role="status">
              {note}
            </span>
          </section>
        </main>
      </ViewerContext.Provider>
    </PlayerContext.Provider>
  );
}

/** The timeline node for a region or highlight, so focus can return to it after its panel closes. */
function objectFocusTarget(root: HTMLElement | null, id: string) {
  const nodes = root?.querySelectorAll<HTMLElement>('[data-region-id], [data-highlight-id]') ?? [];
  const object = [...nodes].find((node) => node.dataset.regionId === id || node.dataset.highlightId === id);
  return object?.matches('button') ? object : (object?.querySelector<HTMLElement>('.tl-region-body') ?? null);
}

/** Follow the player's recorded viewport, including viewport changes during playback. */
function EditorPreviewFrame({ children }: { children: ReactNode }) {
  const viewport = useViewport();
  return (
    <div className="stage-wrap" style={cssVars({ '--editor-preview-ratio': viewport.width / viewport.height })}>
      {children}
    </div>
  );
}

function MobilePlayback({ onSwitch, original, edited }: { onSwitch: () => void; original: number; edited: number }) {
  return (
    <div className="editor-mobile-playback" role="group" aria-label="Playback">
      <EditorPlayButton onSwitch={onSwitch} />
      <EditorClock />
      <span className="editor-mobile-duration">/ {formatClock(original)}</span>
      {Math.round(original) !== Math.round(edited) ? <Durations original={original} edited={edited} /> : null}
    </div>
  );
}

/** A fresh id for the `index`-th of several new regions of `kind` added at once. */
function nextEffectId(edits: ReplayEdits, kind: EffectKind, index: number) {
  const taken = new Set(effectList(edits, kind).map((item) => item.id));
  let n = 1;
  let found = 0;
  for (; ; n++) {
    const id = `${kind}-${n}`;
    if (taken.has(id)) continue;
    if (found === index) return id;
    found++;
  }
}

/**
 * The selected effect's one setting, right after the tools (next to what you just used, not by the lengths): a zoom's depth and a speed-up's rate as a trigger and
 * menu, a caption's text as an inline field. Nothing for other selections.
 */
function EffectControls({
  edits,
  selection,
  change,
  mobile = false,
}: {
  mobile?: boolean;
  edits: ReplayEdits;
  selection: Selection;
  change: (edits: ReplayEdits, select?: Selection) => void;
}) {
  if (!selection || selection.kind === 'range' || selection.kind === 'trim' || selection.kind === 'cut' || selection.kind === 'highlight')
    return null;
  const region = effectList(edits, selection.kind).find((item) => item.id === selection.id);
  if (!region) return null;
  const { kind, id } = selection;
  if (kind === 'caption' && 'text' in region) {
    const onText = (text: string) => change(updateEffect(edits, kind, id, { text }), selection);
    return mobile ? (
      <MobileCaptionField key={id} text={region.text} onChange={onText} />
    ) : (
      <DesktopCaptionField key={id} text={region.text} onChange={onText} />
    );
  }
  if (kind !== 'zoom' && kind !== 'speed') return null;
  const field = kind === 'zoom' ? 'scale' : 'rate';
  const current = (region as unknown as Record<string, number>)[field]!;
  return (
    <EffectSettingMenu
      kind={kind}
      current={current}
      mobile={mobile}
      onPick={(value) => change(updateEffect(edits, kind, id, { [field]: value }), selection)}
    />
  );
}

function DesktopCaptionField({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  return (
    <>
      <span className="editor-bar-divider editor-setting-divider" aria-hidden="true" />
      <input
        className="editor-caption-field"
        defaultValue={text}
        maxLength={160}
        aria-label="Caption text"
        data-testid="caption-text"
        onChange={(event) => {
          const value = event.target.value;
          if (value.trim()) onChange(value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
        }}
      />
    </>
  );
}

function EffectSettingMenu({
  kind,
  current,
  mobile,
  onPick,
}: {
  kind: 'zoom' | 'speed';
  current: number;
  mobile: boolean;
  onPick: (value: number) => void;
}) {
  const options =
    kind === 'zoom'
      ? ZOOM_SCALES.map((value) => ({ value, label: `${value}× zoom` }))
      : SPEED_RATES.map((value) => ({ value, label: `${value}× faster` }));
  return (
    <>
      <span className="editor-bar-divider editor-setting-divider" aria-hidden="true" />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button size="sm" variant="ghost" className="editor-effect-trigger" data-testid={`${kind}-setting`} />}
        >
          {kind === 'zoom' ? `Zoom ${current}×` : `Speed ${current}×`}
          <ChevronDownIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className={mobile ? 'editor-mobile-effect-menu w-auto min-w-36' : 'w-auto min-w-36'}>
          <DropdownMenuRadioGroup value={String(current)} onValueChange={(value) => onPick(Number(value))}>
            {options.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={String(option.value)}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** Keep an unfinished empty draft local; undo/redo still replace the visible saved text. */
function MobileCaptionField({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const [draft, setDraft] = useState({ saved: text, value: text });
  if (draft.saved !== text) setDraft({ saved: text, value: text });
  return (
    <textarea
      id="mobile-caption-text"
      className="editor-caption-field"
      rows={3}
      value={draft.saved === text ? draft.value : text}
      maxLength={160}
      aria-label="Caption text"
      data-testid="caption-text"
      onChange={(event) => {
        const value = event.currentTarget.value;
        setDraft({ saved: text, value });
        if (value.trim()) onChange(value);
      }}
      onBlur={() => {
        if (!draft.value.trim()) setDraft({ saved: text, value: text });
      }}
    />
  );
}

function HighlightTimeInput({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (time: number) => void;
  max: number;
}) {
  return (
    <label className="editor-highlight-time">
      <span>{label} (s)</span>
      <input
        type="number"
        min="0"
        max={(max / 1000).toFixed(1)}
        step="0.1"
        value={(value / 1000).toFixed(1)}
        aria-label={`${label} in seconds`}
        onChange={(event) => {
          const seconds = event.currentTarget.valueAsNumber;
          if (Number.isFinite(seconds)) onChange(Math.round(seconds * 1000));
        }}
      />
    </label>
  );
}

function HighlightControls({
  edits,
  selection,
  duration,
  change,
  afterRemove,
}: {
  afterRemove?: () => void;
  edits: ReplayEdits;
  selection: Selection;
  duration: number;
  change: (edits: ReplayEdits, select?: Selection) => void;
}) {
  if (selection?.kind !== 'highlight') return null;
  const highlight = edits.highlights?.find((item) => item.id === selection.id);
  if (!highlight) return null;
  const update = (patch: Parameters<typeof updateHighlight>[2]) => change(updateHighlight(edits, highlight.id, patch, duration), selection);
  return (
    <div className="editor-highlight-controls" role="group" aria-label="Selected highlight">
      <span className="editor-bar-divider editor-setting-divider" aria-hidden="true" />
      <label className="editor-highlight-label">
        <span>Label</span>
        <input
          key={highlight.id}
          type="text"
          maxLength={120}
          value={highlight.label ?? ''}
          aria-label="Highlight label"
          placeholder="Add a label"
          onChange={(event) => update({ label: event.currentTarget.value })}
        />
      </label>
      {highlight.kind === 'point' ? (
        <HighlightTimeInput label="Time" value={highlight.at} onChange={(at) => update({ kind: 'point', at })} max={duration} />
      ) : (
        <>
          <HighlightTimeInput
            label="From"
            value={highlight.from}
            onChange={(from) => update({ kind: 'period', from })}
            max={Math.max(0, highlight.to - 100)}
          />
          <HighlightTimeInput label="To" value={highlight.to} onChange={(to) => update({ kind: 'period', to })} max={duration} />
        </>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          change(removeHighlight(edits, highlight.id));
          afterRemove?.();
        }}
        data-testid="remove-highlight"
      >
        Remove
      </Button>
    </div>
  );
}

function EditorPlayButton({ onSwitch }: { onSwitch: () => void }) {
  const { status } = usePlayerState();
  const label = status === 'playing' ? 'Pause' : 'Play the result';
  return (
    <IconButton
      label={label}
      shortcut="Space"
      tooltipAlign="start"
      className="play-button text-foreground"
      onClick={onSwitch}
      data-testid="editor-play"
    >
      <span className="icon-swap" data-state={status === 'playing' ? 'b' : 'a'} aria-hidden="true">
        <AnimatedIcon name="play" className="icon-a filled-icon" />
        <AnimatedIcon name="pause" className="icon-b filled-icon" />
      </span>
    </IconButton>
  );
}

/** The playhead on the original timeline. */
function EditorClock() {
  const clock = usePlayhead((time) => formatClock(time));
  return (
    <span className="editor-clock" data-testid="editor-clock">
      {clock}
    </span>
  );
}

/** How long a note stays in the hint line. */
const NOTE_MS = 3200;

/**
 * Feedback for an action that did nothing ("Nothing to cut here"), shown for a moment in the hint line under the
 * timeline, where the eyes already are, instead of a toast over the lanes. A newer note replaces the last.
 */
function useNote() {
  const [note, setNote] = useState<string>();
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const say = useCallback((message: string) => {
    window.clearTimeout(timer.current);
    setNote(message);
    timer.current = window.setTimeout(() => setNote(undefined), NOTE_MS);
  }, []);
  return [note, say] as const;
}

/** "0:03.2 → 0:01.9": the recording's length and what the edits leave (just the length when nothing is removed). */
function Durations({ original, edited }: { original: number; edited: number }) {
  const changed = Math.round(edited) !== Math.round(original);
  return (
    <span
      className="editor-durations"
      role="group"
      data-testid="durations"
      aria-label={changed ? `${formatClock(original)} recorded, ${formatClock(edited)} edited` : `${formatClock(original)} recorded`}
    >
      <span className="editor-durations-original" data-changed={changed || undefined}>
        {formatClock(original)}
      </span>
      {changed ? (
        <>
          <span aria-hidden="true">→</span>
          <strong data-testid="edited-length">{formatClock(edited)}</strong>
        </>
      ) : null}
    </span>
  );
}

/**
 * A quiet word beside the title: Saving… / Saved (who and when in its tooltip). A failed save is a detail here,
 * "Not saved · Retry" (it also retries on its own), and a server without the edits API says so once, in grey.
 */
function SaveIndicator({
  status,
  dirty,
  stored,
  failure,
  onRetry,
}: {
  status: SaveStatus;
  dirty: boolean;
  stored: StoredReplayEdits;
  failure: string;
  onRetry: () => void;
}) {
  if (dirty && status === 'unavailable') {
    return (
      <span className="editor-save-state" data-state="unavailable" data-testid="save-state" role="status">
        Editing isn’t available on this server
      </span>
    );
  }
  if (dirty && status === 'failed') {
    return (
      <span className="editor-save-state" data-state="failed" data-testid="save-state" role="status">
        <Hint label={failure || 'Saving failed'} side="bottom" align="start">
          <span tabIndex={-1}>Not saved</span>
        </Hint>
        <span aria-hidden="true">·</span>
        <button type="button" className="editor-retry" onClick={onRetry} data-testid="save-retry">
          Retry
        </button>
      </span>
    );
  }
  let text: ReactNode = stored.revision > 0 ? 'Saved' : 'Not edited yet';
  if (status === 'saving' || dirty) text = 'Saving…';
  const saved = text === 'Saved';
  const detail =
    stored.revision > 0 && stored.updatedBy
      ? `Last saved by ${stored.updatedBy} · ${savedAgo(stored.updatedAt)}`
      : 'Changes save as you edit';
  return (
    <Hint label={detail} side="bottom" align="start">
      <span className="editor-save-state" data-state={saved ? 'saved' : status} data-testid="save-state" role="status" tabIndex={-1}>
        {saved ? <CheckIcon aria-hidden="true" /> : null}
        {text}
      </span>
    </Hint>
  );
}

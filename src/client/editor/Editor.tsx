import { useEditorArrival } from '../hooks/use-editor-arrival.ts';
import { EditorPluginTools } from '../plugins/EditorTools.tsx';
import { editorSurfaceContext, EditorHostSurface, EditorTopbarActions } from './EditorHostSurface.tsx';
import { HostSurfaceSlot } from '../plugins/HostSurface.tsx';
import { usePluginSnapshot } from '../plugins/PluginUi.tsx';
import { resolveSlot } from '../plugins/registry.ts';
import './editor.css';

import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  MousePointer2Icon,
  CheckIcon,
  HourglassIcon,
  Redo2Icon,
  Undo2Icon,
  FileVideoCameraIcon,
  KeyboardIcon,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Hint } from '@/components/icon-button.tsx';
import { Button } from '@/components/ui/button.tsx';

import { EMPTY_EDITS, editListOf, editTimeline, isEmptyEdits, type ReplayEdits, type StoredReplayEdits } from '../../shared/edits.ts';
import { clicksOf, IDENTITY_TIME, playbackEffects, proposeStepCaptions, proposeZoomRegions } from '../../shared/effects.ts';
import { EditCaption } from '../edit-caption.tsx';
import type { Speed } from '../player.ts';
import { BlurOverlay } from './BlurOverlay.tsx';
import { EffectLanes } from './EffectLanes.tsx';
import { Durations } from './Durations.tsx';
import { EDITOR_DOCK } from './dock-size.ts';
import { EditHistory, EditorDockBar, InspectorAside, PhoneUndo, WaitSuggestion } from './EditorChrome.tsx';
import { removeSelection } from './remove-selection.ts';
import { duplicateEffect, splitEffect } from './phone-edits.ts';
import { type PhoneObjectActions, PhoneObjectToolbar, selectionKey } from './PhoneObjectToolbar.tsx';
import { PhoneSheet } from './PhoneSheet.tsx';
import { PhoneTimeline } from './PhoneTimeline.tsx';
import { objectTitle } from './SelectionInspector.tsx';
import type { ReplayBundle } from '../../shared/replay.ts';
import { EditsConflictError, EditsUnavailableError, editsQuery, type LoadedEdits, saveEdits } from '../edits.ts';
import { collectErrors } from '../issues.ts';
import { MOBILE_QUERY, useMediaQuery } from '../media.ts';
import { navigate } from '../routing/navigate.ts';
import { PlayerContext, ReplayController, useViewport } from '../player.ts';
import { replayHref } from '../routing/links.ts';
import { nextStepIndex, previousStepIndex } from '../timeline.ts';
import { notify } from '../toast.ts';
import { MoreMenu, Topbar, type TopbarMenuItem } from '../Topbar.tsx';
import { useHasKeyboard } from '../hooks/use-has-keyboard.ts';
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
  savedAgo,
  type Selection,
  type EditorAction,
  setTrimEdge,
  trimOf,
  waitSuggestions,
  addEffect,
  noRoomFor,
  type EffectKind,
  effectList,
  NEW_EFFECT_MS,
  withEffectList,
} from './state.ts';
import { handOff } from './handoff.ts';
import { cssVars } from '../lib/css-vars.ts';
import { applyHighlight, highlightHere } from './highlight-actions.ts';
import { Timeline } from './Timeline.tsx';
import { useBetaFlag } from '../settings/labs.ts';
import { cursorInput } from '../cursor-motion.ts';
import { followsRecordedPath } from '../cursor-recorded-path.ts';
import { CursorInspector } from './CursorInspector.tsx';
import { AddMenu, BarTools, EmptyTracksItem } from './EditorTools.tsx';
import { IS_MAC, MOD } from './editor-tools.ts';
import { EditorShortcutSheet } from './EditorShortcutSheet.tsx';
import { EffectControls, HighlightControls } from './SelectionControls.tsx';
import { EditorExport } from './EditorExport.tsx';
import { MobileInspector, MobileAddToolbar, mobileTimelineObjects } from './MobileInspector.tsx';

/** Quiet time after the last change before it is saved. */
const AUTOSAVE_MS = 700;

type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed' | 'unavailable';
/** Retries after a failed save: 2 s, 4 s, 8 s… up to RETRY_MAX_MS. */
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30_000;

/** The timeline dock: resized from its top edge like the viewer's diagnostics panel, kept under its own key. */
const DEFAULT_DOCK_HEIGHT = EDITOR_DOCK.height;
const DOCK_SIZE: PanelSize = {
  storageKey: EDITOR_DOCK.storageKey,
  variable: '--dock-height',
  min: EDITOR_DOCK.min,
  max: () => Math.max(EDITOR_DOCK.min, Math.round(window.innerHeight * 0.65)),
  label: 'Resize timeline',
};

/**
 * Edit mode (`/r/<id>/edit`), in the spirit of Screen Studio: a large preview, one control row, and one wide
 * timeline that holds every edit (src/client/editor/Timeline.tsx). Everything is direct manipulation: drag the clip's
 * edges to trim, drag across the clip to select and C to cut, drag a cut's edges or remove it from its ×. "Remove
 * waits" first shows the waits it found on the track; Enter applies them all. Playback previews the result live (cuts
 * are skipped, it stops at the trim end). Changes save on their own (a quiet "Saved"); the back button returns to the viewer.
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { enabled: cursorCustomization } = useBetaFlag('cursorCustomization');
  const [cursorOpen, setCursorOpen] = useState(false);
  const focusCaption = useRef(false);
  const [mobileTrimOpen, setMobileTrimOpen] = useState(false);
  // why: keyed by selectionKey, so the phone sheet closes when another object is selected.
  const [sheetFor, setSheetFor] = useState<string>();
  const mobileReturnFocus = useRef<HTMLElement | null>(null);
  const [blurPlacement, setBlurPlacement] = useState<{ from: number; to: number }>();
  const [note, say] = useNote();
  const mobile = useMediaQuery(MOBILE_QUERY);
  const shell = useRef<HTMLElement>(null);
  useEditorArrival(shell);
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

  const change = useCallback((next: ReplayEdits, select?: Selection, merge = false) => {
    dispatch({ type: 'change', edits: next, ...(select ? { select } : {}), ...(merge ? { merge } : {}) });
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
        const removed = removeSelection(live.current.state.present, live.current.state.selection);
        if (removed) change(removed);
      },
      /** M, the Highlight tool and the phone's highlight actions: the selected range when there is one, else the moment. */
      highlight: () => {
        const { state: current, timeline: kept } = live.current;
        const request = { present: current.present, selection: current.selection, timeline: kept, time: player.getTime(), duration };
        applyHighlight(openingSheet(change, setSheetFor), say, highlightHere(request));
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
          const first = captions.at(0);
          if (first) {
            change(withEffectList(present, 'caption', captions), { kind: 'caption', id: first.id });
            return;
          }
        }
        const time = player.getTime();
        const added = range
          ? addEffect(present, kind, range.from, range.to, duration)
          : addEffect(present, kind, time, time + NEW_EFFECT_MS, duration);
        if (added) change(added.edits, { kind, id: added.id });
        else say(noRoomFor(kind));
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
          return actions.highlight();
        case 'apply':
          if (live.current.suggestions.length) applySuggestions();
          else if (live.current.state.selection?.kind === 'range') actions.cut();
          return;
        case 'delete':
          return actions.deleteSelection();
        case 'shortcuts':
          return setShortcutsOpen(true);
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

  const hasKeyboard = useHasKeyboard();
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
      ...(hasKeyboard
        ? [
            {
              label: 'Keyboard shortcuts',
              icon: <KeyboardIcon aria-hidden="true" />,
              onSelect: () => setShortcutsOpen(true),
              shortcut: '?',
              testId: 'editor-shortcuts',
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
    [actions.removeWaits, change, edits, hasKeyboard, id, leave, mobile, state],
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
    const field = document.getElementById('selection-caption-text');
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
    (target ?? shell.current?.querySelector<HTMLElement>('.phone-playhead'))?.focus({ preventScroll: true });
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
      if (kind === 'caption') setSheetFor(`caption:${existing.id}`);
      return;
    }
    if (kind === 'blur') {
      actions.effect('blur');
      return;
    }
    const added = addEffect(present, kind, at, Math.min(trimOf(present, duration).end, at + NEW_EFFECT_MS), duration);
    if (added) {
      change(added.edits, { kind, id: added.id });
      if (kind === 'caption') setSheetFor(`caption:${added.id}`);
    } else {
      focusCaption.current = false;
      say('No room here · move the playhead earlier');
    }
  };
  const sheetKey = selectionKey(mobileSelection);
  const sheetShown =
    mobile && (sheetFor === 'host' || cursorOpen || Boolean(blurPlacement) || (sheetKey !== undefined && sheetFor === sheetKey));
  const closeSheet = () => {
    setSheetFor(undefined);
    setCursorOpen(false);
    setBlurPlacement(undefined);
    let target = mobileReturnFocus.current;
    mobileReturnFocus.current = null;
    // why: the toolbar swaps with the selection, so the button that opened the sheet may be gone; the object stays.
    if (!target?.isConnected && mobileSelection && 'id' in mobileSelection) target = objectFocusTarget(shell.current, mobileSelection.id);
    if (target?.isConnected) target.focus({ preventScroll: true });
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
  const cursorInspector = cursorCustomization ? (
    <CursorInspector
      embedded={!mobile}
      recordedPath={followsRecordedPath(bundle.meta.source, cursorInput(bundle.events).points)}
      settings={edits.cursor}
      onChange={(cursor) => {
        const { cursor: _previous, ...rest } = live.current.state.present;
        change(cursor ? { ...rest, cursor } : rest);
      }}
      onClose={finishMobileObject}
    />
  ) : null;
  const selectionCommands = {
    onSelectRange: (from: number, to: number) => dispatch({ type: 'select', selection: { kind: 'range', from, to } }),
    onDone: mobile ? finishMobileObject : () => dispatch({ type: 'select', selection: undefined }),
    onDelete: () => {
      actions.deleteSelection();
      if (!mobile) return;
      mobileReturnFocus.current = shell.current?.querySelector<HTMLElement>('.phone-playhead') ?? null;
      finishMobileObject();
    },
    onCut: actions.cut,
    onPeriodHighlight: actions.highlight,
  };
  const phoneActions: PhoneObjectActions = {
    adjust: () => {
      rememberMobileFocus();
      player.pause();
      setSheetFor(sheetKey);
    },
    split: (kind, regionId) => {
      const split = splitEffect(live.current.state.present, { kind, id: regionId, time: player.getTime(), duration });
      if (split) change(split.edits, { kind, id: split.id });
      else say('Move the playhead inside it, away from its ends, to split it');
    },
    duplicate: (kind, regionId) => {
      const copy = duplicateEffect(live.current.state.present, kind, regionId, duration);
      if (copy) change(copy.edits, { kind, id: copy.id });
      else say('No room after it for a copy');
    },
    remove: () => selectionCommands.onDelete(),
    cut: actions.cut,
    speedUp: () => addMobileObject('speed'),
    done: finishMobileObject,
  };
  const phoneInspector = (
    <MobileInspector
      edits={edits}
      selection={mobileSelection}
      duration={duration}
      change={change}
      commands={{ ...selectionCommands, onDone: closeSheet }}
      cursorOpen={cursorOpen}
      placingBlur={Boolean(blurPlacement)}
      panels={{
        cursorInspector,
        effectControls: <EffectControls edits={edits} selection={selection} change={change} />,
        highlightControls: <HighlightControls edits={edits} selection={selection} duration={duration} change={change} />,
      }}
    />
  );
  usePluginSnapshot();
  const hostInspector =
    resolveSlot('editor.inspector.sections', [], editorSurfaceContext({ bundle, edits, selection, duration, change, seek: player.seek }))
      .length > 0;

  return (
    <PlayerContext.Provider value={player}>
      <EditorHostSurface bundle={bundle} edits={edits} selection={selection} duration={duration} change={change} seek={player.seek}>
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
                <EditorTopbarActions
                  history={<PhoneUndo state={state} dispatch={dispatch} />}
                  exports={<EditorExport meta={bundle.meta} stored={stored} dirty={dirty} saving={status === 'saving'} />}
                />
                <MoreMenu
                  theme
                  always
                  items={[
                    ...menuItems.filter((item) => item.testId !== 'undo'),
                    ...(hostInspector
                      ? [
                          {
                            label: 'Replay settings',
                            icon: <AnimatedIcon name="info" />,
                            onSelect: () => {
                              mobileReturnFocus.current =
                                shell.current?.querySelector<HTMLElement>('.editor-mobile-header .topbar-more') ?? null;
                              dispatch({ type: 'select', selection: undefined });
                              setCursorOpen(false);
                              setBlurPlacement(undefined);
                              setSheetFor('host');
                            },
                          },
                        ]
                      : []),
                    ...(cursorCustomization
                      ? [
                          {
                            label: 'Cursor options',
                            icon: <MousePointer2Icon aria-hidden="true" />,
                            onSelect: () => {
                              // why: the menu item leaves with the menu; closing the cursor panel returns to the More trigger.
                              mobileReturnFocus.current =
                                shell.current?.querySelector<HTMLElement>('.editor-mobile-header .topbar-more') ?? null;
                              dispatch({ type: 'select', selection: undefined });
                              setMobileTrimOpen(false);
                              setBlurPlacement(undefined);
                              setCursorOpen(true);
                            },
                            testId: 'editor-cursor-options',
                          },
                        ]
                      : []),
                  ]}
                />
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
                menuSettings={<EmptyTracksItem checked={showEmptyTracks} onChange={setShowEmptyTracks} />}
                alwaysMenu
                actions={
                  <EditorTopbarActions
                    history={<EditHistory state={state} dispatch={dispatch} />}
                    exports={<EditorExport meta={bundle.meta} stored={stored} dirty={dirty} saving={status === 'saving'} />}
                  />
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
              {!mobile && (selection || cursorCustomization || hostInspector) ? (
                <InspectorAside
                  edits={edits}
                  selection={selection}
                  duration={duration}
                  change={change}
                  commands={selectionCommands}
                  replay={cursorInspector}
                />
              ) : null}
            </section>
            {mobile ? null : <InspectorResizer shell={shell} height={dockHeight} onCommit={setDockHeight} size={DOCK_SIZE} />}
            <section className="editor-dock" aria-label={mobile ? 'Editing tools' : 'Timeline'}>
              {mobile ? (
                <EditorPluginTools context={{ replay: bundle, edits, duration, getTime: player.getTime }} onApply={change} />
              ) : null}
              {mobile && suggesting && suggestions.length ? (
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
              {mobile ? null : (
                <EditorDockBar
                  onPlay={playPause}
                  total={timeline.originalDuration}
                  tools={
                    <EditorPluginTools context={{ replay: bundle, edits, duration, getTime: player.getTime }} onApply={change}>
                      <BarTools
                        rangeSelected={selection?.kind === 'range'}
                        suggesting={suggesting}
                        onTool={(tool) => ({ cut: actions.cut, waits: actions.removeWaits, highlight: actions.highlight })[tool]()}
                      />
                    </EditorPluginTools>
                  }
                  add={<AddMenu onAdd={actions.effect} />}
                  end={
                    suggesting && suggestions.length ? (
                      <WaitSuggestion count={suggestions.length} onApply={applySuggestions} onDismiss={() => setSuggesting(false)} />
                    ) : (
                      <Durations original={timeline.originalDuration} edited={timeline.duration} />
                    )
                  }
                />
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
                {mobile ? (
                  <PhoneTimeline
                    duration={duration}
                    edited={timeline.duration}
                    edits={edits}
                    steps={bundle.steps}
                    selection={mobileSelection}
                    dispatch={timelineDispatch}
                    onPlayPause={playPause}
                  />
                ) : (
                  <Timeline
                    steps={bundle.steps}
                    duration={duration}
                    edits={edits}
                    selection={selection}
                    dispatch={dispatch}
                    suggestions={suggestions}
                    onCutRange={actions.cut}
                    lanes={(['zoom', 'speed', 'blur', 'caption'] as const).map((kind, index) => ({
                      id: `core:${kind}`,
                      order: (index + 2) * 100,
                      render: () => (
                        <EffectLanes only={kind} edits={edits} selection={selection} dispatch={dispatch} showEmpty={showEmptyTracks} />
                      ),
                    }))}
                  />
                )}
              </div>
              {mobile ? (
                <>
                  {mobileSelection ? (
                    <PhoneObjectToolbar selection={mobileSelection} actions={phoneActions} />
                  ) : (
                    <MobileAddToolbar
                      objects={mobileTimelineObjects(edits)}
                      onSelectObject={(object) => {
                        timelineDispatch({ type: 'select', selection: object.selection });
                        mobileReturnFocus.current = shell.current?.querySelector<HTMLElement>('.editor-add-more') ?? null;
                        player.pause();
                        player.seek(object.at);
                        setSheetFor(selectionKey(object.selection));
                        if (object.selection?.kind === 'caption') focusCaption.current = true;
                      }}
                      onCut={() => {
                        rememberMobileFocus();
                        setCursorOpen(false);
                        setMobileTrimOpen(false);
                        setBlurPlacement(undefined);
                        actions.cut();
                      }}
                      onCaption={() => addMobileObject('caption')}
                      onBlur={() => addMobileObject('blur')}
                      onZoom={() => addMobileObject('zoom')}
                      more={[
                        // why: the desktop bar's and Add menu's names, so a tool is called the same on both.
                        {
                          label: 'Waits',
                          icon: 'hourglass',
                          hint: 'Find waits to remove',
                          action: actions.removeWaits,
                          testId: 'remove-waits',
                        },
                        {
                          label: 'Speed up',
                          icon: 'fast-forward',
                          hint: 'Speed up from the playhead',
                          action: () => addMobileObject('speed'),
                          testId: 'add-speed',
                        },
                        {
                          label: 'Trim',
                          icon: 'columns-2',
                          hint: 'Set where the clip starts and ends',
                          action: () => {
                            rememberMobileFocus();
                            player.pause();
                            setSheetFor('trim');
                            setCursorOpen(false);
                            setMobileTrimOpen(true);
                            setBlurPlacement(undefined);
                            dispatch({ type: 'select', selection: { kind: 'trim' } });
                          },
                          testId: 'mobile-trim',
                        },
                        {
                          label: 'Select a range',
                          icon: 'text-cursor-input',
                          hint: 'To cut or highlight a stretch',
                          action: selectMobileRange,
                          testId: 'select-range',
                        },
                        {
                          label: 'Highlight',
                          icon: 'map-pin',
                          hint: 'Highlight this moment',
                          action: () => {
                            rememberMobileFocus();
                            setCursorOpen(false);
                            setMobileTrimOpen(false);
                            setBlurPlacement(undefined);
                            actions.highlight();
                          },
                          testId: 'add-point-highlight',
                        },
                        ...(cursorCustomization
                          ? [
                              {
                                label: 'Cursor options',
                                icon: 'mouse-pointer-2' as const,
                                hint: 'How the pointer looks and moves',
                                action: () => {
                                  rememberMobileFocus();
                                  setMobileTrimOpen(false);
                                  setBlurPlacement(undefined);
                                  dispatch({ type: 'select', selection: undefined });
                                  setCursorOpen(true);
                                },
                              },
                            ]
                          : []),
                        {
                          label: 'Captions',
                          icon: 'captions',
                          hint: edits.captions?.length ? 'Already on the timeline' : 'Write captions from the steps',
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
                          label: 'Zoom',
                          icon: 'zoom-in',
                          hint: 'Zoom in on every click',
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
                  )}
                  <PhoneSheet
                    open={sheetShown}
                    label={sheetFor === 'host' ? 'Replay settings' : objectTitle(mobileSelection?.kind, cursorOpen, Boolean(blurPlacement))}
                    container={shell}
                    onClose={closeSheet}
                  >
                    <HostSurfaceSlot
                      slot="editor.inspector.sections"
                      builtins={
                        sheetFor === 'host'
                          ? []
                          : [
                              {
                                id: cursorOpen ? 'core:replay' : 'core:selection',
                                order: 100,
                                render: () => phoneInspector,
                              },
                            ]
                      }
                    />
                  </PhoneSheet>
                </>
              ) : null}
              {note ? (
                <p className="editor-operation-status" data-testid="editor-operation-status" aria-hidden="true">
                  {note}
                </p>
              ) : null}
              <span className="sr-only" role="status" data-testid="editor-operation-announcement">
                {note}
              </span>
            </section>
          </main>
          <EditorShortcutSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        </ViewerContext.Provider>
      </EditorHostSurface>
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

/** `change` for a new highlight that also opens its sheet on a phone, for its label (the sheet only shows there). */
function openingSheet(change: (edits: ReplayEdits, select?: Selection) => void, open: (key: string) => void) {
  return (next: ReplayEdits, select?: Selection) => {
    change(next, select);
    if (select?.kind === 'highlight') open(`highlight:${select.id}`);
  };
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

/** How long an operation result remains visible. */
const NOTE_MS = 3200;

/**
 * Feedback for an action that did nothing ("Nothing to cut here"), shown briefly below the timeline and announced
 * by its stable live region. There is no standing instruction row; a newer note replaces the last.
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

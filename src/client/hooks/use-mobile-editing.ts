import { type Dispatch, type RefObject, useEffect, useRef, useState } from 'react';

import type { EditTimeline, ReplayEdits } from '../../shared/edits.ts';
import type { BlurPlacement, EditorActions } from '../editor/actions.ts';
import { addEffect, type EditorAction, type EditorState, type EffectKind, effectList, NEW_EFFECT_MS, type Selection, trimOf } from '../editor/state.ts';
import { editorStrings } from '../editor/strings.ts';
import type { ReplayController } from '../player.ts';

const FOCUSABLE = 'button, a, summary, input, textarea, [tabindex]';

interface MobileEditingOptions {
  mobile: boolean;
  shell: RefObject<HTMLElement | null>;
  player: ReplayController;
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  live: { readonly current: { state: EditorState; timeline: EditTimeline } };
  change: (edits: ReplayEdits, select?: Selection) => void;
  say: (message: string) => void;
  actions: EditorActions;
  setBlurPlacement: (placement: BlurPlacement | undefined) => void;
}

/**
 * The phone's object flow: one object's properties at a time (the cursor, the clip's trim, a selected region), focus
 * returned to where it came from when it is done, and a new caption's text focused as it appears.
 */
export function useMobileEditing({ mobile, shell, player, state, dispatch, live, change, say, actions, setBlurPlacement }: MobileEditingOptions) {
  const [cursorOpen, setCursorOpen] = useState(false);
  const [trimOpen, setTrimOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const focusCaption = useRef(false);
  const selection = state.selection;
  // Opening the untouched clip is UI state: the reducer correctly stores no redundant full-duration trim.
  const mobileSelection: Selection = trimOpen && !selection ? { kind: 'trim' } : selection;

  useEffect(() => {
    if (!mobile || !focusCaption.current || selection?.kind !== 'caption') return;
    const field = document.getElementById('mobile-caption-text') as HTMLTextAreaElement | null;
    field?.focus({ preventScroll: true });
    field?.select();
    focusCaption.current = false;
  }, [mobile, selection]);

  const ruler = () => shell.current?.querySelector<HTMLElement>('.editor-ruler-seek') ?? null;
  /** Closes whatever object panel is open (cursor, trim, blur placement). */
  const settle = () => {
    setCursorOpen(false);
    setTrimOpen(false);
    setBlurPlacement(undefined);
  };
  const remember = () => {
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement && active.matches(FOCUSABLE) ? active : null;
  };
  const finish = () => {
    let target = returnFocus.current;
    if (!target?.isConnected || target.closest('.editor-context-panel')) target = null;
    if (!target && selection && 'id' in selection) {
      const regions = shell.current?.querySelectorAll<HTMLElement>('[data-region-id], [data-highlight-id]');
      const object = [...(regions ?? [])].find((node) => node.dataset.regionId === selection.id || node.dataset.highlightId === selection.id);
      target = object?.matches('button') ? object : (object?.querySelector<HTMLElement>('.tl-region-body') ?? null);
    }
    dispatch({ type: 'select', selection: undefined });
    settle();
    (target ?? ruler())?.focus({ preventScroll: true });
    returnFocus.current = null;
  };

  return {
    cursorOpen,
    mobileSelection,
    settle,
    remember,
    finish,
    /** Finishes from a removal: focus goes back to the ruler. */
    finishFromRuler: () => {
      returnFocus.current = ruler();
      finish();
    },
    returnTo: (element: HTMLElement | null) => {
      returnFocus.current = element;
    },
    focusCaptionNext: () => {
      focusCaption.current = true;
    },
    /** The timeline's dispatch on phones: selecting an object closes the others' panels. */
    timelineDispatch: (action: EditorAction) => {
      if (mobile && (action.type === 'select' || (action.type === 'change' && action.select))) {
        const selected = action.type === 'select' ? action.selection : action.select;
        setTrimOpen(selected?.kind === 'trim');
        returnFocus.current = null;
        setCursorOpen(false);
        setBlurPlacement(undefined);
      }
      dispatch(action);
    },
    openCursor: () => {
      remember();
      setTrimOpen(false);
      setBlurPlacement(undefined);
      dispatch({ type: 'select', selection: undefined });
      setCursorOpen(true);
    },
    openTrim: () => {
      remember();
      player.pause();
      setCursorOpen(false);
      setTrimOpen(true);
      setBlurPlacement(undefined);
      dispatch({ type: 'select', selection: { kind: 'trim' } });
    },
    /** Esc: every object panel closes. */
    close: () => setTrimOpen(false),
    add: (kind: EffectKind) => {
      remember();
      player.pause();
      settle();
      const at = player.getTime();
      const { state: current, timeline } = live.current;
      const present = current.present;
      if (timeline.isRemoved(at)) {
        say(editorStrings.notes.keptMomentFirst);
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
      const added = addEffect(present, kind, at, Math.min(trimOf(present, player.duration).end, at + NEW_EFFECT_MS), player.duration);
      if (added) change(added.edits, { kind, id: added.id });
      else {
        focusCaption.current = false;
        say(editorStrings.notes.noRoomEarlier);
      }
    },
    selectRange: () => {
      remember();
      player.pause();
      settle();
      const bounds = trimOf(live.current.state.present, player.duration);
      const from = Math.max(bounds.start, Math.min(player.getTime(), bounds.end - 100));
      dispatch({ type: 'select', selection: { kind: 'range', from, to: Math.min(bounds.end, from + 1000) } });
      player.seek(from);
    },
  };
}

export type MobileEditing = ReturnType<typeof useMobileEditing>;

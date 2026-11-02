import { type EditTimeline, MAX_HIGHLIGHTS, type ReplayCut, type ReplayEdits } from '../../shared/edits.ts';
import { clicksOf, proposeStepCaptions, proposeZoomRegions } from '../../shared/effects.ts';
import type { ReplayBundle } from '../../shared/replay.ts';
import type { ReplayController } from '../player.ts';
import {
  addCut,
  addEffect,
  addPeriodHighlight,
  addPointHighlight,
  clearTrim,
  cutRange,
  type EditorState,
  type EffectKind,
  effectList,
  NEW_EFFECT_MS,
  removeCut,
  removeEffect,
  removeHighlight,
  type Selection,
  setTrimEdge,
  trimOf,
  waitSuggestions,
  withEffectList,
} from './state.ts';
import { editorStrings } from './strings.ts';

const notes = editorStrings.notes;

export interface BlurPlacement {
  from: number;
  to: number;
}

export interface EditorActionDeps {
  player: ReplayController;
  bundle: Pick<ReplayBundle, 'steps' | 'events'>;
  /** The latest editor state, timeline and found waits (read when an action runs, never captured). */
  live: { readonly current: { state: EditorState; timeline: EditTimeline; suggestions: readonly ReplayCut[] } };
  change: (edits: ReplayEdits, select?: Selection) => void;
  say: (message: string) => void;
  setSuggesting: (on: boolean) => void;
  setBlurPlacement: (placement: BlurPlacement | undefined) => void;
}

/** A fresh id for the `index`-th of several new regions of `kind` added at once. */
export function nextEffectId(edits: ReplayEdits, kind: EffectKind, index: number) {
  const taken = new Set(effectList(edits, kind).map((item) => item.id));
  let found = 0;
  for (let n = 1; ; n++) {
    const id = `${kind}-${n}`;
    if (taken.has(id)) continue;
    if (found === index) return id;
    found++;
  }
}

/** Zoom regions for every click not zoomed yet. */
export function zoomOnClicks(edits: ReplayEdits, bundle: Pick<ReplayBundle, 'events'>, duration: number) {
  return proposeZoomRegions(clicksOf(bundle.events), duration, edits.zooms ?? [], undefined, (index) => nextEffectId(edits, 'zoom', index));
}

/** The editor's operations, shared by the dock, the keyboard and the phone's tools. */
export function createEditorActions(deps: EditorActionDeps) {
  const { player, bundle, live, change, say, setSuggesting, setBlurPlacement } = deps;
  const read = () => live.current;
  const duration = player.duration;

  const applySuggestions = () => {
    const { state, suggestions } = read();
    setSuggesting(false);
    if (!suggestions.length) return;
    change({ ...state.present, cuts: [...state.present.cuts, ...suggestions] });
  };

  return {
    applySuggestions,
    trimStart: () => change(setTrimEdge(read().state.present, 'start', player.getTime(), duration), { kind: 'trim' }),
    trimEnd: () => change(setTrimEdge(read().state.present, 'end', player.getTime(), duration), { kind: 'trim' }),
    /** C / S: cut the selected range, else a second at the playhead. */
    cut: () => {
      const { present, selection } = read().state;
      const added =
        selection?.kind === 'range' ? cutRange(present, selection.from, selection.to, duration) : addCut(present, player.getTime(), duration);
      if (added) change(added.edits, { kind: 'cut', id: added.id });
      else say(notes.nothingToCut);
    },
    /** W: show the waits it would cut; again (or Enter) applies them. */
    removeWaits: () => {
      if (read().suggestions.length) {
        applySuggestions();
        return;
      }
      if (!waitSuggestions(read().state.present, bundle.steps, duration).length) {
        say(bundle.steps.some((step) => step.kind === 'wait') ? notes.noWaitsLeft : notes.noWaitSteps);
        return;
      }
      setSuggesting(true);
    },
    deleteSelection: () => {
      const { present, selection } = read().state;
      if (selection?.kind === 'trim') change(clearTrim(present));
      else if (selection?.kind === 'cut') change(removeCut(present, selection.id));
      else if (selection?.kind === 'highlight') change(removeHighlight(present, selection.id));
      else if (selection && selection.kind !== 'range') change(removeEffect(present, selection.kind, selection.id));
    },
    pointHighlight: () => {
      const at = player.getTime();
      const { state, timeline } = read();
      const present = state.present;
      const exists = present.highlights?.some((highlight) => highlight.kind === 'point' && highlight.at === at);
      if (!exists && (present.highlights?.length ?? 0) >= MAX_HIGHLIGHTS) {
        say(notes.highlightLimit);
        return;
      }
      if (timeline.isRemoved(at)) {
        say(notes.keptMomentHighlight);
        return;
      }
      const added = addPointHighlight(present, at, duration);
      change(added.edits, { kind: 'highlight', id: added.id });
    },
    periodHighlight: () => {
      const { state, timeline } = read();
      const { present, selection } = state;
      if ((present.highlights?.length ?? 0) >= MAX_HIGHLIGHTS) {
        say(notes.highlightLimit);
        return;
      }
      if (selection?.kind !== 'range') {
        say(notes.selectStretch);
        return;
      }
      const bounds = trimOf(present, duration);
      const from = Math.max(bounds.start, selection.from);
      const to = Math.min(bounds.end, selection.to);
      if (timeline.toEdited(to) <= timeline.toEdited(from)) {
        say(notes.stretchRemains);
        return;
      }
      const added = addPeriodHighlight(present, from, to, duration);
      if (added) change(added.edits, { kind: 'highlight', id: added.id });
      else say(notes.tooShort);
    },
    /**
     * Z / F / B / T: an effect over the selected range, else at the playhead. Zoom with nothing selected zooms in on
     * every click; captions with none yet come from the steps. Blur first asks for a box on the preview.
     */
    effect: (kind: EffectKind) => {
      const { present, selection } = read().state;
      const range = selection?.kind === 'range' ? selection : undefined;
      if (kind === 'blur') {
        player.pause();
        const from = range?.from ?? player.getTime();
        setBlurPlacement({ from, to: range?.to ?? Math.min(duration, from + NEW_EFFECT_MS) });
        return;
      }
      setBlurPlacement(undefined);
      if (!range && kind === 'zoom') {
        const regions = zoomOnClicks(present, bundle, duration);
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
      else say(kind === 'speed' ? notes.alreadySped : notes.noRoom);
    },
    /** Places the pending blur over `box` (fractions of the recorded frame). */
    placeBlur: (placement: BlurPlacement | undefined, box: { x: number; y: number; width: number; height: number }) => {
      if (!placement) return;
      const added = addEffect(read().state.present, 'blur', placement.from, placement.to, duration, box);
      if (added) change(added.edits, { kind: 'blur', id: added.id });
      else say(notes.blurOutside);
      setBlurPlacement(undefined);
    },
  };
}

export type EditorActions = ReturnType<typeof createEditorActions>;

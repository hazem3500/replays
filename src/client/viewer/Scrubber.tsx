import type { FocusSpot } from './focus-marks.ts';
import { memo, type RefObject, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { formatClock, type ReplayStep } from '../../shared/replay.ts';
import type { ProjectedHighlight } from '../../shared/highlights.ts';
import type { ReplayError } from '../issues.ts';
import { useScrubberPresenceMotion } from '../hooks/use-scrubber-presence-motion.ts';
import { usePlayer } from '../player.ts';
import { positionText } from '../timeline.ts';
import { FeatureScrubberOverlays } from '../plugins/features.tsx';
import { PluginTimelineTracks } from '../plugins/PluginSlots.tsx';
import { usePluginSnapshot } from '../plugins/PluginUi.tsx';
import { resolveSlot } from '../plugins/registry.ts';
import type { SlotDescriptor } from '../plugins/slots.ts';
import { useViewer } from './context.ts';
import { setPreviewTime } from './preview-time.ts';
import { highlightEdge, highlightTargetOffsets } from '../highlights-layout.ts';
import { useHighlightTargetSize } from '../hooks/use-highlight-target-size.ts';
import { cssVars } from '../lib/css-vars.ts';
import {
  barBox,
  clampCentre,
  ERROR_NOTCH_GAP,
  easeOut,
  type HighlightSpot,
  notchX,
  resolveHover,
  runLabel,
  type ScrubberMark,
  type ScrubberSegment,
  scrubberMarks,
  scrubberSegments,
  segmentAt,
  segmentFill,
  snapIndex,
} from './scrubber-marks.ts';
import './scrubber.css';

/** Hover intent for labels: rest this long (drifting at most STILL_TOLERANCE px) before the bubble names the step. */
export const HOVER_INTENT_MS = 500;
const STILL_TOLERANCE = 3;
/** An error dot this close (px) to the pointer is what a hover names, ahead of the step under it. */
const MARK_TOLERANCE = 5;
/** After a label goes, a neighbouring bar's (or dot's) label comes instantly for this long. */
const WARM_MS = 300;
/** The range thumb's centre travels from half its width to the width minus half its width; the bars match. */
const INSET = 6;
/** Share of the remaining distance the bubble covers per 60 Hz frame: settles in ~60 ms, never overshoots. */
const FOLLOW = 0.55;
/** Discrete seeks glide the fill and knob to their new place this long (ease-out); drags and playback don't. */
const SEEK_GLIDE_MS = 220;
/** While dragging, a bar boundary this close (px) captures the seek; Alt drags freely. */
const SNAP_PX = 4;
/** After the last seek (a drag, a key, a jump) the knob stays this long, then fades. */
const KNOB_LINGER_MS = 800;
const ANNOTATION_DRAG_PX = 5;

function useTrackWidth(element: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const target = element.current;
    if (!target) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(0, target.clientWidth - INSET * 2)));
    observer.observe(target);
    return () => observer.disconnect();
  }, [element]);
  return width;
}

/**
 * The replay's scrubber: one rounded bar per step (Apple Watch / stories style), 4 px tall at rest and
 * 6 px under the pointer, growing about the centre line. Past bars are full accent, the current one fills
 * up to the playhead, future ones are neutral. Under a mouse the hovered bar brightens, the knob scales in
 * and a slim time bubble follows the pointer; resting on a bar (hover intent) names its step inside that
 * bubble ("0:01.9 · Type the email"). Error marks are small red dots under the bars.
 *
 * The native range input stays on top, invisible: it owns keys, assistive tech and mouse dragging and
 * gives the 28 px (40 px on touch) hit area. Everything that moves with the playhead or the pointer is
 * written straight to the DOM, so neither playback nor hovering re-renders React.
 */
const TRACKS_SLOT = 'viewer.scrubber.tracks';
const NO_STEPS: ReplayStep[] = [];
const NO_ERRORS: ReplayError[] = [];
const NO_HIGHLIGHTS: ProjectedHighlight[] = [];
const NO_SPOTS: readonly FocusSpot[] = [];

/**
 * The seek bar's built-in tracks as `viewer.scrubber.tracks` items, so a host's hide applies to them as to plugin tracks
 * (which rank after these). Their geometry is fixed (steps shape the bars, errors notch them, highlights sit above), so
 * order only places plugin rows; a hidden steps track leaves one unbroken bar.
 */
const BUILTIN_TRACKS: readonly SlotDescriptor<undefined, null>[] = [
  { id: 'core:steps', order: 100, render: () => null },
  { id: 'core:errors', order: 200, render: () => null },
  { id: 'core:highlights', order: 300, render: () => null },
];

export function Scrubber({ steps: allSteps, errors: allErrors }: { steps: ReplayStep[]; errors: ReplayError[] }) {
  const { highlights: allHighlights = NO_HIGHLIGHTS, tracks: viewTracks, focusSpots = NO_SPOTS } = useViewer();
  // why: a host's slot configuration changes the registry snapshot; reading it re-renders the bar with it.
  usePluginSnapshot();
  const tracks = new Set(
    resolveSlot(TRACKS_SLOT, BUILTIN_TRACKS, undefined)
      .map((track) => track.id)
      .filter((id) => !viewTracks || viewTracks.includes(id)),
  );
  const steps = tracks.has('core:steps') ? allSteps : NO_STEPS;
  const errors = tracks.has('core:errors') ? allErrors : NO_ERRORS;
  const highlights = tracks.has('core:highlights') ? allHighlights : NO_HIGHLIGHTS;
  const player = usePlayer();
  const root = useRef<HTMLDivElement>(null);
  useScrubberPresenceMotion(root);
  const input = useRef<HTMLInputElement>(null);
  const bars = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLSpanElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const bubbleTime = useRef<HTMLSpanElement>(null);
  const bubbleLabel = useRef<HTMLSpanElement>(null);
  const beginAnnotationScrub = useRef<((event: PointerEvent) => void) | undefined>(undefined);
  const ignoreAnnotationClick = useRef(false);
  const width = useTrackWidth(root);
  const [selectedHighlight, setSelectedHighlight] = useState<string>();

  // The range's value and text, which assistive tech reads, follow pauses and explicit seeks but not the
  // playback clock: a slider the keyboard sits on would otherwise be announced on every frame while the replay plays.
  useLayoutEffect(() => {
    const sync = () => {
      const element = input.current;
      if (!element) return;
      const time = player.getTime();
      element.value = String(time);
      element.setAttribute('aria-valuetext', positionText(time, player.duration));
    };
    sync();
    const offSeek = player.subscribeSeek(sync);
    const offState = player.subscribeState(sync);
    return () => {
      offSeek();
      offState();
    };
  }, [player]);

  const segments = useMemo(() => scrubberSegments(steps, player.duration, width), [player.duration, steps, width]);
  // Error notches: merged within 4 px, and moved out of any gap onto the nearest bar.
  const errorMarks = useMemo(() => {
    const boxes = segments.map((segment, index) => barBox(segment, index, segments.length, player.duration, width));
    return scrubberMarks([], errors, player.duration, width, ERROR_NOTCH_GAP).map((mark) => ({ ...mark, x: notchX(mark.x, boxes) }));
  }, [errors, player.duration, segments, width]);

  // why: focus notches merge like error notches so a dense run stays readable; a merged notch names the first marker.
  const focusMarks = useMemo(() => {
    const boxes = segments.map((segment, index) => barBox(segment, index, segments.length, player.duration, width));
    return scrubberMarks(focusSpots, [], player.duration, width, ERROR_NOTCH_GAP).map((mark) => ({ ...mark, x: notchX(mark.x, boxes) }));
  }, [focusSpots, player.duration, segments, width]);

  // The interaction engine: plain listeners and refs, rebuilt only when the bars, marks or width change.
  useLayoutEffect(() => {
    const element = root.current;
    const range = input.current;
    const barsEl = bars.current;
    const knobEl = knob.current;
    const anchorEl = anchor.current;
    const bubbleEl = bubble.current;
    const timeEl = bubbleTime.current;
    const labelEl = bubbleLabel.current;
    if (!element || !range || !barsEl || !knobEl || !anchorEl || !bubbleEl || !timeEl || !labelEl) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const duration = player.duration;
    const span = width + INSET * 2;
    const dpr = window.devicePixelRatio || 1;
    const snap = (value: number) => Math.round(value * dpr) / dpr;
    const toX = (time: number) => (duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0) * width;
    const toTime = (x: number) => (width > 0 ? Math.round((x / width) * duration) : 0);
    const pointerX = (clientX: number) => Math.min(width, Math.max(0, clientX - element.getBoundingClientRect().left - INSET));
    const barEls = [...barsEl.querySelectorAll<HTMLElement>('.scrubber-segment')];
    const fillEls = barEls.map((bar) => bar.firstElementChild as HTMLElement);
    const boxes = segments.map((segment, index) => barBox(segment, index, segments.length, duration, width));
    const boundaryAts = segments.slice(1).map((segment) => segment.start);
    const boundaryXs = boundaryAts.map(toX);

    let scrubbing = false;
    let hovering = false;
    let lastPointerX = 0;
    /** A keyboard seek just landed on a step and the bubble names it. */
    let landed = false;
    let keyed = false;

    // ---- Bubble: content, position, follow ----
    let shown = false;
    let text = '';
    let label = '';
    let kind = '';
    let size = 0;
    let x = 0;
    let target = 0;
    let frame = 0;
    let last = 0;
    const write = (time: number, nextLabel: string, nextKind: string) => {
      const nextText = formatClock(time);
      let measure = size === 0;
      if (nextText !== text) {
        // Tabular figures: the width only changes with the number of characters.
        measure ||= nextText.length !== text.length;
        timeEl.textContent = nextText;
        text = nextText;
      }
      if (nextLabel !== label) {
        labelEl.textContent = nextLabel;
        label = nextLabel;
        measure = true;
      }
      if (nextKind !== kind) {
        bubbleEl.dataset.kind = nextKind;
        kind = nextKind;
      }
      if (measure) size = anchorEl.offsetWidth;
    };
    const place = (centre: number) => {
      const left = clampCentre(centre + INSET, size, span) - size / 2;
      anchorEl.style.transform = `translate3d(${snap(left)}px, 0, 0)`;
    };
    const follow = (now: number) => {
      const elapsed = Math.min(64, now - last);
      last = now;
      x += (target - x) * (1 - (1 - FOLLOW) ** (elapsed / (1000 / 60)));
      if (Math.abs(target - x) < 0.25) {
        x = target;
        frame = 0;
      } else {
        frame = requestAnimationFrame(follow);
      }
      place(x);
    };
    /** Moves the bubble's centre to `next` (track px): eased while it is already showing, at once otherwise. */
    const show = (next: number, instant = false) => {
      target = next;
      if (!shown || instant || reducedMotion.matches) {
        cancelAnimationFrame(frame);
        frame = 0;
        x = next;
        place(x);
      } else if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(follow);
      }
      if (!shown) {
        bubbleEl.dataset.visible = 'true';
        shown = true;
      }
    };
    const hide = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      landed = false;
      if (!shown) return;
      bubbleEl.dataset.visible = 'false';
      shown = false;
    };

    // ---- Bars: fills and knob ----
    const fills = fillEls.map(() => -1);
    /** Time the fills and knob show; it trails the playhead only while a seek glides. */
    let drawn = player.getTime();
    /** Knob x for a time: inside the bar holding it, so it always sits on the fill's end. */
    const knobX = (time: number) => {
      const index = segmentAt(segments, time);
      const box = boxes[index];
      const segment = segments[index];
      if (!box || !segment) return toX(time);
      return box.left + segmentFill(segment, time) * box.width;
    };
    const draw = (time: number) => {
      drawn = time;
      for (const [index, segment] of segments.entries()) {
        const value = segmentFill(segment, time);
        if (value === fills[index]) continue;
        fills[index] = value;
        const fillEl = fillEls[index];
        if (fillEl) fillEl.style.transform = `scaleX(${value})`;
      }
      knobEl.style.transform = `translate3d(${knobX(time)}px, 0, 0)`;
    };
    // Discrete seeks (a step, an error, a key, a permalink) glide there; playback and dragging stay exact.
    // A new seek retargets from wherever the glide is, so key repeat never stacks animations.
    const glide = { frame: 0, start: 0, from: 0 };
    let seekFrom: number | null = null;
    const glideStep = () => {
      // The clock starts on the first frame the glide is drawn in, not at the seek: the seek's own work (rrweb
      // rendering the new moment) can hold the main thread longer than the glide lasts, and the glide must
      // still be seen rather than land at once. One clock throughout (a frame's timestamp is when the frame
      // began, which can run ahead of or behind performance.now() on a busy main thread).
      const now = performance.now();
      if (glide.start < 0) glide.start = now;
      const t = Math.min(1, (now - glide.start) / SEEK_GLIDE_MS);
      const goal = player.getTime();
      if (t >= 1 || scrubbing) {
        glide.frame = 0;
        draw(goal);
        return;
      }
      draw(glide.from + (goal - glide.from) * easeOut(t));
      glide.frame = requestAnimationFrame(glideStep);
    };
    const stopGlide = () => {
      cancelAnimationFrame(glide.frame);
      glide.frame = 0;
    };
    // The knob shows while seeking and lingers a moment after the last seek (never for plain playback).
    let linger = 0;
    const seeking = () => {
      element.dataset.seeking = '';
      window.clearTimeout(linger);
      linger = window.setTimeout(() => {
        delete element.dataset.seeking;
      }, KNOB_LINGER_MS);
    };
    const onDiscreteSeek = () => {
      seeking();
      const goal = player.getTime();
      const from = glide.frame ? drawn : (seekFrom ?? drawn);
      if (scrubbing || reducedMotion.matches || Math.abs(toX(goal) - toX(from)) < 1) {
        stopGlide();
        draw(goal);
        return;
      }
      glide.from = from;
      glide.start = -1;
      draw(from);
      if (!glide.frame) glide.frame = requestAnimationFrame(glideStep);
    };
    const paint = () => {
      const time = player.getTime();
      // While gliding, the glide's own frame loop draws (towards the live playhead). A seek notifies time
      // listeners before seek listeners, so remember where the fill was for this task: the glide starts there.
      if (!glide.frame) {
        if (seekFrom === null) {
          seekFrom = drawn;
          queueMicrotask(() => {
            seekFrom = null;
          });
        }
        draw(time);
      }
      if (scrubbing) {
        // Dragging: the bubble rides the knob exactly, with the time it shows. A finger has no hover intent to
        // name steps, so a touch drag names the step under it as it goes ("0:04.1 · Log in").
        const touchLabel = element.dataset.scrubbing === 'mouse' ? '' : (segments[segmentAt(segments, time)]?.label ?? '');
        write(time, touchLabel, touchLabel ? 'step' : 'time');
        show(knobX(time), true);
        setPreviewTime(time);
      }
    };

    // ---- Hover: the hovered bar, the bubble and hover intent (mouse only; touch has no hover) ----
    let hoveredBar = -1;
    const setHoveredBar = (index: number) => {
      if (index === hoveredBar) return;
      if (barEls[hoveredBar]) delete barEls[hoveredBar]!.dataset.hover;
      if (barEls[index]) barEls[index]!.dataset.hover = '';
      hoveredBar = index;
    };
    /** What the pointer is over: a highlight marker, else an error dot close by (`e3`), else the bar under it (`s1`), or ''. */
    let spots: HighlightSpot[] = [];
    const readSpots = () => {
      const origin = element.getBoundingClientRect().left + INSET;
      return [...element.querySelectorAll<HTMLElement>('.scrubber-highlight-marker')].map((marker) => {
        const box = marker.getBoundingClientRect();
        return {
          x: box.left + box.width / 2 - origin,
          at: Number(marker.dataset.at),
          label: marker.dataset.label ?? '',
        };
      });
    };
    const targetAt = (at: number) => {
      spots = readSpots();
      const bar = segmentAt(segments, toTime(at));
      return resolveHover(spots, errorMarks, at, bar >= 0 && segments[bar]!.label ? bar : -1, MARK_TOLERANCE);
    };
    const intent = { timer: 0, key: '', anchor: 0, shown: '', warmUntil: 0 };
    const clearIntent = (warm: boolean) => {
      window.clearTimeout(intent.timer);
      intent.timer = 0;
      intent.key = '';
      intent.warmUntil = warm && intent.shown ? performance.now() + WARM_MS : warm ? intent.warmUntil : 0;
      intent.shown = '';
    };
    const renderHover = () => {
      const index = Number(intent.shown.slice(1));
      const highlight = intent.shown.startsWith('h') ? spots[index] : undefined;
      if (highlight) {
        write(highlight.at, highlight.label, 'highlight');
        show(highlight.x);
        setPreviewTime(highlight.at);
        return;
      }
      const error = intent.shown.startsWith('e') ? errorMarks[index] : undefined;
      if (error) {
        write(error.at, error.label, 'error');
        show(error.x);
        setPreviewTime(error.at);
        return;
      }
      const time = toTime(lastPointerX);
      const bar = intent.shown.startsWith('s') ? segments[index] : undefined;
      write(time, bar?.label ?? '', bar ? 'step' : 'time');
      show(lastPointerX);
      setPreviewTime(time);
    };
    const onHover = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || scrubbing) return;
      delete bubbleEl.dataset.instant;
      landed = false;
      hovering = true;
      const at = pointerX(event.clientX);
      lastPointerX = at;
      setHoveredBar(segmentAt(segments, toTime(at)));
      const key = targetAt(at);
      if (!key) {
        if (intent.shown || intent.timer) clearIntent(true);
      } else if (key !== intent.shown) {
        if (intent.shown || performance.now() < intent.warmUntil) {
          // Warm: a neighbour's label swaps in at once.
          window.clearTimeout(intent.timer);
          intent.timer = 0;
          intent.shown = key;
        } else if (!(intent.timer && intent.key === key && Math.abs(at - intent.anchor) <= STILL_TOLERANCE)) {
          // Cold: wait for the pointer to settle.
          window.clearTimeout(intent.timer);
          intent.key = key;
          intent.anchor = at;
          intent.timer = window.setTimeout(() => {
            intent.timer = 0;
            intent.shown = key;
            if (hovering && !scrubbing) renderHover();
          }, HOVER_INTENT_MS);
        }
      }
      renderHover();
    };
    const onLeave = () => {
      if (scrubbing) return;
      hovering = false;
      clearIntent(false);
      setHoveredBar(-1);
      hide();
      setPreviewTime(null);
    };

    // ---- Pressing and dragging ----
    let alt = false;
    /**
     * A seek from a pointer drag: within SNAP_PX of a bar boundary it lands on the boundary exactly (Alt
     * drags freely).
     */
    const dragSeek = (ms: number) => {
      const near = alt ? -1 : snapIndex(boundaryXs, toX(ms), SNAP_PX);
      player.seek(near >= 0 ? boundaryAts[near]! : ms);
    };
    // Touch and pen: a native range only moves when you hit its (invisible) thumb, so the whole strip
    // seeks to the finger and follows it; touch-action: none keeps the page still.
    const seekTo = (clientX: number) => dragSeek(toTime(pointerX(clientX)));
    const onInput = () => {
      const value = Number(range.value);
      if (scrubbing) dragSeek(value);
      else player.seek(value);
    };
    const trackAlt = (event: PointerEvent | KeyboardEvent) => {
      alt = event.altKey;
    };
    let pointer = -1;
    let annotationPointer = false;
    let annotationStartX = 0;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointer = event.pointerId;
      alt = event.altKey;
      stopGlide();
      player.beginScrub();
      clearIntent(false);
      delete bubbleEl.dataset.instant;
      landed = false;
      keyed = false;
      scrubbing = true;
      element.dataset.scrubbing = event.pointerType;
      setHoveredBar(-1);
      const at = pointerX(event.clientX);
      write(toTime(at), '', 'time');
      show(at, true);
      setPreviewTime(toTime(at));
      if (event.pointerType === 'mouse') return;
      if (annotationPointer) {
        seekTo(event.clientX);
        return;
      }
      range.setPointerCapture(event.pointerId);
      seekTo(event.clientX);
    };
    const onDrag = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      if (annotationPointer && Math.abs(event.clientX - annotationStartX) >= ANNOTATION_DRAG_PX) ignoreAnnotationClick.current = true;
      if (event.pointerType !== 'mouse' && range.hasPointerCapture(event.pointerId)) seekTo(event.clientX);
    };
    const onAnnotationMove = (event: PointerEvent) => {
      if (!annotationPointer || event.pointerId !== pointer) return;
      if (Math.abs(event.clientX - annotationStartX) >= ANNOTATION_DRAG_PX) {
        ignoreAnnotationClick.current = true;
        seekTo(event.clientX);
      }
    };
    const onUp = (event: PointerEvent) => {
      if (!scrubbing || event.pointerId !== pointer) return;
      pointer = -1;
      annotationPointer = false;
      scrubbing = false;
      delete element.dataset.scrubbing;
      seeking();
      player.endScrub();
      if (event.pointerType === 'mouse' && element.matches(':hover')) {
        hovering = true;
        lastPointerX = pointerX(event.clientX);
        setHoveredBar(segmentAt(segments, toTime(lastPointerX)));
        renderHover();
      } else {
        hovering = false;
        hide();
        setPreviewTime(null);
      }
      if (ignoreAnnotationClick.current)
        window.setTimeout(() => {
          ignoreAnnotationClick.current = false;
        }, 0);
    };

    beginAnnotationScrub.current = (event) => {
      annotationPointer = true;
      annotationStartX = event.clientX;
      onDown(event);
    };

    // ---- Keyboard: no hover bubble, except naming a step a key lands exactly on ----
    const onKey = () => {
      keyed = true;
    };
    const onKeyUp = () => {
      keyed = false;
    };
    const onSeek = () => {
      if (scrubbing || hovering || !keyed || document.activeElement !== range) return;
      keyed = false;
      const time = player.getTime();
      const index = steps.findIndex((step) => Math.abs(step.at - time) < 1);
      if (index < 0) {
        if (landed) hide();
        return;
      }
      bubbleEl.dataset.instant = '';
      write(time, runLabel([steps[index]!.label]), 'step');
      show(knobX(time), true);
      landed = true;
    };
    const onBlur = () => {
      keyed = false;
      if (landed) hide();
    };
    const markerOf = (event: Event) => (event.target as Element | null)?.closest<HTMLElement>('.scrubber-highlight-marker') ?? null;
    const onMarkerFocus = (event: FocusEvent) => {
      const marker = markerOf(event);
      if (!marker || scrubbing || !marker.matches(':focus-visible')) return;
      const box = marker.getBoundingClientRect();
      bubbleEl.dataset.instant = '';
      write(Number(marker.dataset.at), marker.dataset.label ?? '', 'highlight');
      show(box.left + box.width / 2 - element.getBoundingClientRect().left - INSET, true);
      landed = true;
    };
    const onMarkerBlur = (event: FocusEvent) => {
      if (markerOf(event) && landed && !hovering) hide();
    };

    draw(player.getTime());
    const offTime = player.subscribeTime(paint);
    const offSeek = player.subscribeSeek(onSeek);
    const offGlide = player.subscribeSeek(onDiscreteSeek);
    element.addEventListener('pointermove', onHover);
    element.addEventListener('pointerleave', onLeave);
    range.addEventListener('pointerdown', onDown);
    range.addEventListener('pointermove', onDrag);
    range.addEventListener('input', onInput);
    range.addEventListener('keydown', onKey);
    range.addEventListener('keyup', onKeyUp);
    range.addEventListener('blur', onBlur);
    element.addEventListener('focusin', onMarkerFocus);
    element.addEventListener('focusout', onMarkerBlur);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('pointermove', onAnnotationMove, true);
    window.addEventListener('pointermove', trackAlt, true);
    window.addEventListener('keydown', trackAlt, true);
    window.addEventListener('keyup', trackAlt, true);
    return () => {
      offTime();
      offSeek();
      offGlide();
      stopGlide();
      element.removeEventListener('pointermove', onHover);
      element.removeEventListener('pointerleave', onLeave);
      range.removeEventListener('pointerdown', onDown);
      range.removeEventListener('pointermove', onDrag);
      range.removeEventListener('input', onInput);
      range.removeEventListener('keydown', onKey);
      range.removeEventListener('keyup', onKeyUp);
      range.removeEventListener('blur', onBlur);
      element.removeEventListener('focusin', onMarkerFocus);
      element.removeEventListener('focusout', onMarkerBlur);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('pointermove', onAnnotationMove, true);
      window.removeEventListener('pointermove', trackAlt, true);
      window.removeEventListener('keydown', trackAlt, true);
      window.removeEventListener('keyup', trackAlt, true);
      window.clearTimeout(intent.timer);
      window.clearTimeout(linger);
      cancelAnimationFrame(frame);
      if (scrubbing) player.endScrub();
      beginAnnotationScrub.current = undefined;
      setPreviewTime(null);
    };
  }, [errorMarks, player, segments, steps, width]);

  return (
    <div ref={root} className="scrubber" data-slot={TRACKS_SLOT}>
      <div className="scrubber-rail" aria-hidden="true">
        <div className="scrubber-key-ring" />
        <div ref={bars} className="scrubber-bars">
          <Segments segments={segments} width={width} />
          <ErrorNotches marks={errorMarks} />
          <FocusNotches marks={focusMarks} />
        </div>
      </div>
      <input
        ref={input}
        type="range"
        min="0"
        max={player.duration}
        step="1"
        defaultValue={0}
        aria-label="Seek"
        onKeyDown={(event) => {
          // The value can lag the clock while playing (see above), so page jumps start from the playhead.
          if (event.key !== 'PageUp' && event.key !== 'PageDown') return;
          event.preventDefault();
          player.seek(player.getTime() + (event.key === 'PageUp' ? 1 : -1) * Math.max(1000, player.duration / 10));
        }}
      />
      <div className="scrubber-knob-rail" aria-hidden="true">
        <span ref={knob} className="scrubber-knob">
          <span className="scrubber-knob-visual" />
        </span>
      </div>
      <FeatureScrubberOverlays width={width} inset={INSET} />
      <PluginTimelineTracks width={width} inset={INSET} />
      <HighlightMarks
        marks={highlights}
        width={width}
        duration={player.duration}
        selected={selectedHighlight}
        onPointerDown={(event) => beginAnnotationScrub.current?.(event)}
        onFocus={setSelectedHighlight}
        onSelect={(id, at) => {
          if (ignoreAnnotationClick.current) {
            ignoreAnnotationClick.current = false;
            return;
          }
          setSelectedHighlight(id);
          player.seek(at);
        }}
      />
      <div ref={anchor} className="scrubber-bubble-anchor" aria-hidden="true">
        <div ref={bubble} className="scrubber-bubble" data-visible="false" data-kind="time" data-testid="scrubber-bubble">
          <span ref={bubbleTime} className="scrubber-bubble-time" data-testid="scrubber-bubble-time" />
          <span ref={bubbleLabel} className="scrubber-bubble-label" data-testid="scrubber-bubble-label" />
        </div>
      </div>
    </div>
  );
}

function HighlightMarks({
  marks,
  width,
  duration,
  selected,
  onPointerDown,
  onFocus,
  onSelect,
}: {
  marks: ProjectedHighlight[];
  width: number;
  duration: number;
  selected?: string | undefined;
  onPointerDown: (event: PointerEvent) => void;
  onFocus: (id: string) => void;
  onSelect: (id: string, at: number) => void;
}) {
  const targetSize = useHighlightTargetSize();
  if (width <= 0 || duration <= 0 || marks.length === 0) return null;
  const x = (time: number) => Math.min(width, Math.max(0, (time / duration) * width));
  const markers = marks.flatMap((mark) => {
    const from = mark.kind === 'point' ? mark.at : mark.from;
    const to = mark.kind === 'point' ? mark.at : mark.to;
    return [from, ...(mark.kind === 'period' ? [to] : [])].map((at, index) => ({ mark, at, index, x: x(at) }));
  });
  const offsets = highlightTargetOffsets(
    markers.map((marker) => marker.x),
    width,
    targetSize,
  );
  let markerIndex = 0;
  return (
    <div className="scrubber-highlight-layer" data-testid="scrubber-highlights">
      {marks.map((mark) => {
        const from = mark.kind === 'point' ? mark.at : mark.from;
        const to = mark.kind === 'point' ? mark.at : mark.to;
        const label = mark.label?.trim();
        const title = `${mark.kind === 'point' ? 'Point highlight' : 'Period highlight'}${label ? `: ${label}` : ''}`;
        return (
          <span key={`${mark.id}-${mark.kind === 'period' ? mark.part : 'point'}`} className="scrubber-highlight" data-kind={mark.kind}>
            {mark.kind === 'period' ? (
              <span
                className="scrubber-highlight-band"
                aria-hidden="true"
                style={{ left: `${x(from)}px`, width: `${Math.max(2, x(to) - x(from))}px` }}
              />
            ) : null}
            {[from, ...(mark.kind === 'period' ? [to] : [])].map((at, index) => {
              const targetOffset = offsets[markerIndex++] ?? 0;
              const edge = highlightEdge(mark.kind, index);
              return (
                <button
                  key={`${mark.id}-${edge ?? 'point'}`}
                  type="button"
                  className="scrubber-highlight-marker"
                  data-kind={mark.kind}
                  data-edge={edge}
                  data-selected={selected === mark.id || undefined}
                  aria-label={`${title} at ${formatClock(at)}`}
                  aria-pressed={selected === mark.id}
                  data-at={at}
                  data-label={label ?? ''}
                  style={cssVars({ '--target-offset': `${targetOffset}px` }, { left: `${x(at)}px` })}
                  onFocus={() => onFocus(mark.id)}
                  onPointerDown={(event) => onPointerDown(event.nativeEvent)}
                  onClick={() => onSelect(mark.id, at)}
                >
                  <span className="scrubber-highlight-glyph" aria-hidden="true" />
                  {selected === mark.id && label && (mark.kind === 'point' || (mark.part === 0 && index === 0)) ? (
                    <span className="scrubber-highlight-label">{label}</span>
                  ) : null}
                </button>
              );
            })}
          </span>
        );
      })}
    </div>
  );
}

/** The bars, each with its fill; positioned in whole device pixels so their caps and gaps stay sharp. */
const Segments = memo(function Segments({ segments, width }: { segments: ScrubberSegment[]; width: number }) {
  const player = usePlayer();
  if (width <= 0) return null;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const px = (value: number) => Math.round(value * dpr) / dpr;
  return segments.map((segment, index) => {
    const box = barBox(segment, index, segments.length, player.duration, width);
    const left = px(box.left);
    return (
      <div
        key={`${segment.start}-${segment.first}`}
        className="scrubber-segment"
        data-testid="scrubber-segment"
        style={{ left: `${left}px`, width: `${Math.max(1, px(box.left + box.width) - left)}px` }}
      >
        <div className="scrubber-segment-fill" />
        <div className="scrubber-segment-hover" />
      </div>
    );
  });
});

/**
 * Errors as notches on the bars (like ad marks on a video timeline): 2 px of red at the error's time,
 * above the fill, growing with the bars. Merged errors are one notch; the hover bubble gives the count.
 */
const FocusNotches = memo(function FocusNotches({ marks }: { marks: ScrubberMark[] }) {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return marks.map((mark) => (
    <span
      key={`${mark.at}-${mark.x}`}
      role="img"
      className="focus-notch"
      data-testid="focus-marker"
      aria-label={`Focus: ${mark.label} at ${formatClock(mark.at)}`}
      style={{ left: `${Math.round((mark.x - 1) * dpr) / dpr}px` }}
    />
  ));
});

const ErrorNotches = memo(function ErrorNotches({ marks }: { marks: ScrubberMark[] }) {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return marks.map((mark) => (
    <span
      key={`${mark.at}-${mark.x}`}
      role="img"
      className="error-notch"
      data-testid="error-marker"
      aria-label={`${mark.label} at ${formatClock(mark.at)}`}
      style={{ left: `${Math.round((mark.x - 1) * dpr) / dpr}px` }}
    />
  ));
});

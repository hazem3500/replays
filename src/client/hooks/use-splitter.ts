import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';

import { readStorage, writeStorage } from '../storage.ts';

/** Within this many px of a snap point a drag lands on it. */
const SNAP_PX = 8;
/** Dragging this far past `min` folds a collapsible panel. */
const COLLAPSE_PX = 48;
/** How long the target keeps `data-splitter-settling` (its CSS spring) after a snap, reset or fold. */
const SETTLE_MS = 360;

export interface SplitterConfig {
  /** The separator line's orientation: `horizontal` sits between a top and a bottom panel (row-resize). */
  orientation: 'horizontal' | 'vertical';
  /** Which side of the line the sized panel is on: `end` = below / right of it. */
  side: 'start' | 'end';
  /** The panel's committed size, px. */
  value: number;
  min: number;
  max: number;
  /** Double-click and Reset go back to this. */
  defaultValue: number;
  /** Sizes a drag snaps to (px, within 8 px). */
  snapPoints?: readonly number[];
  collapsible?: boolean;
  collapsed?: boolean;
  onChange: (size: number) => void;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Called at most once per frame while dragging: size the panel without a React render (a CSS variable). */
  onPreview?: (size: number, collapsed: boolean) => void;
  /** Committed sizes are kept here, per browser. */
  storageKey?: string;
  /** The element whose size changes animate: it gets `data-splitter-settling` while a snap, reset or fold settles. */
  settleTarget?: { current: HTMLElement | null };
  label: string;
  /** Arrow-key step, px (Shift: four times). */
  step?: number;
}

/** A saved size for `storageKey`, clamped to [min, max], else `fallback`. */
export function readSplitterSize(storageKey: string, fallback: number, min: number, max: number) {
  const saved = Number(readStorage(storageKey));
  const size = Number.isFinite(saved) && saved > 0 ? saved : fallback;
  return Math.round(Math.min(Math.max(size, min), Math.max(min, max)));
}

const clamp = (size: number, min: number, max: number) => Math.round(Math.min(Math.max(size, min), Math.max(min, max)));

function snapped(size: number, points: readonly number[] = []) {
  for (const point of points) if (Math.abs(size - point) <= SNAP_PX) return point;
  return size;
}

/**
 * Headless resizable split: pointer drag (rAF-throttled previews, document-wide resize cursor), snap points,
 * collapse past `min`, double-click to reset, and the separator keyboard pattern (arrows, Shift for bigger steps,
 * Home/End, Enter folds). Spread `separatorProps` on the handle.
 */
export function useSplitter(config: SplitterConfig) {
  const { orientation, side, value, min, max, defaultValue, collapsible = false, collapsed = false, step = 16 } = config;
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ start: number; from: number; size: number; folded: boolean; frame: number } | undefined>(undefined);

  const settle = () => {
    const target = config.settleTarget?.current;
    if (!target || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    target.setAttribute('data-splitter-settling', '');
    window.setTimeout(() => target.removeAttribute('data-splitter-settling'), SETTLE_MS);
  };
  const commit = (size: number, fold = false, animate = false) => {
    if (animate) settle();
    if (fold !== collapsed) config.onCollapsedChange?.(fold);
    if (fold) return;
    const next = clamp(size, min, max);
    if (config.storageKey) writeStorage(config.storageKey, String(next));
    config.onChange(next);
  };
  /** Pointer travel → panel size: moving the line toward the panel shrinks it. */
  const sizeFor = (position: number) => {
    const state = drag.current!;
    const delta = (position - state.start) * (side === 'end' ? -1 : 1);
    const raw = state.from + delta;
    const folded = collapsible && raw < min - COLLAPSE_PX;
    return { size: folded ? state.from : clamp(snapped(raw, config.snapPoints), min, max), folded };
  };
  const coordinate = (event: PointerEvent) => (orientation === 'horizontal' ? event.clientY : event.clientX);
  const finish = (keep: boolean) => {
    const state = drag.current;
    if (!state) return;
    cancelAnimationFrame(state.frame);
    drag.current = undefined;
    delete document.documentElement.dataset.splitterDrag;
    setDragging(false);
    if (keep) commit(state.size, state.folded, state.folded !== collapsed);
    else config.onPreview?.(value, collapsed);
  };

  const separatorProps = {
    role: 'separator',
    'aria-orientation': orientation,
    'aria-label': config.label,
    'aria-valuemin': collapsible ? 0 : min,
    'aria-valuemax': Math.max(min, max),
    'aria-valuenow': collapsed ? 0 : value,
    tabIndex: 0,
    'data-orientation': orientation,
    'data-dragging': dragging || undefined,
    'data-collapsed': collapsed || undefined,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const from = collapsed ? min - COLLAPSE_PX : value;
      drag.current = { start: coordinate(event), from, size: value, folded: collapsed, frame: 0 };
      document.documentElement.dataset.splitterDrag = orientation;
      setDragging(true);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const state = drag.current;
      if (!state) return;
      const next = sizeFor(coordinate(event));
      state.size = next.folded ? value : next.size;
      state.folded = next.folded;
      if (state.frame) return;
      // why: one layout per frame, however many pointer events arrive.
      state.frame = requestAnimationFrame(() => {
        state.frame = 0;
        config.onPreview?.(state.size, state.folded);
      });
    },
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    onLostPointerCapture: () => finish(true),
    onDoubleClick: () => commit(defaultValue, false, true),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const toward: Record<string, number> =
        orientation === 'horizontal' ? { ArrowUp: -1, ArrowDown: 1 } : { ArrowLeft: -1, ArrowRight: 1 };
      const move = toward[event.key];
      const base = collapsed ? min : value;
      if (move !== undefined) commit(base + move * (event.shiftKey ? step * 4 : step) * (side === 'end' ? -1 : 1));
      else if (event.key === 'Home') commit(min);
      else if (event.key === 'End') commit(max);
      else if (event.key === 'Enter' && collapsible) commit(value, !collapsed, true);
      else return;
      event.preventDefault();
      // why: the player listens for arrows on the document (seek); on a splitter they resize.
      event.stopPropagation();
    },
  };

  return { separatorProps, dragging };
}

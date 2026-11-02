import { createContext, use, useSyncExternalStore } from 'react';

import type { EditTimeline } from '../../shared/edits.ts';
import type { ReplayBundle } from '../../shared/replay.ts';
import { usePlayer } from '../player.ts';
import type { InspectorTab } from './context.ts';

/*
 * The seam between an inspector dock and the page hosting it (spec: .review-artifacts/design-hillclimb/spec-inspector-scope.md).
 * The single-replay viewer provides one source and its player's clock; the meeting stage (/compare, suite Grid and
 * Spotlight) provides one source per tile and a shared clock. The tab row, the dock shell and the panels read only
 * this scope, never the viewer's or the player's context, so the same dock renders under either page.
 */

/** One replay the dock can show. */
export interface InspectorSource {
  /** Stable; the replay id in the viewer. */
  id: string;
  bundle: ReplayBundle;
  /** The source's edited timeline, when edits are applied. */
  timeline?: EditTimeline;
  /** ms: source-local time = shared time + offset (0 in the viewer). */
  offset: number;
  /** The tile's name ("Before", "Run 3"); the replay title in the viewer. */
  label: string;
  /** A CSS custom property reference for the tile's colour, e.g. 'var(--tile-2)' (meeting only). */
  colour?: string;
}

/** The shared clock; `subscribe` is useSyncExternalStore-compatible. */
export interface InspectorClock {
  /** Shared ms. */
  getTime(): number;
  subscribe(listener: () => void): () => void;
  seek(sharedMs: number): void;
}

/** A row in a panel, addressed across sources. */
export interface InspectorRowRef {
  sourceId: string;
  tab: InspectorTab;
  rowId: string;
  /** Shared ms. */
  at: number;
}

export interface InspectorScope {
  /** One in the viewer; one per tile in the meeting. */
  sources: readonly InspectorSource[];
  /** The source single-scope panels show; comments attach here. */
  focusedId: string;
  /** `all` merges every source's rows on the shared axis. */
  mode: 'single' | 'all';
  clock: InspectorClock;
  onFocus?(sourceId: string): void;
  /** Tile ring and scrubber marker highlight; `undefined` when the pointer or focus leaves. */
  onHover?(ref: InspectorRowRef | undefined): void;
  /** A row opened; without it the dock seeks the shared clock and focuses the row's source (`openRow`). */
  onOpen?(ref: InspectorRowRef): void;
}

const InspectorScopeContext = createContext<InspectorScope | null>(null);

/** Hosts wrap their dock in this. */
export const InspectorScopeProvider = InspectorScopeContext;

export function useInspectorScope() {
  const scope = use(InspectorScopeContext);
  if (!scope) throw new Error('useInspectorScope needs an InspectorScopeProvider');
  return scope;
}

/** The source single-scope panels show. */
export function focusedSource(scope: InspectorScope): InspectorSource {
  return scope.sources.find((source) => source.id === scope.focusedId) ?? scope.sources[0]!;
}

/** Shared ms → the source's own time. */
export function sourceTime(source: InspectorSource, sharedMs: number) {
  return sharedMs + source.offset;
}

/** Opens a row: the host's handler, else seek the shared clock to it and focus its source. */
export function openRow(scope: InspectorScope, ref: InspectorRowRef) {
  if (scope.onOpen) return scope.onOpen(ref);
  scope.clock.seek(ref.at);
  scope.onFocus?.(ref.sourceId);
}

/**
 * The shared playhead, selected: pass a selector that returns a primitive (an index, a count) so the caller
 * re-renders only when that value changes.
 */
export function useScopeTime<T = number>(select?: (sharedMs: number) => T): T {
  const { clock } = useInspectorScope();
  return useSyncExternalStore(clock.subscribe, () => (select ? select(clock.getTime()) : (clock.getTime() as T)));
}

/** The viewer's scope: one source (the captured bundle with its edits) on the player's clock. */
export function singleScope(bundle: ReplayBundle, timeline: EditTimeline | undefined, clock: InspectorClock): InspectorScope {
  const source: InspectorSource = { id: bundle.meta.id, bundle, offset: 0, label: bundle.meta.title, ...(timeline ? { timeline } : {}) };
  return { sources: [source], focusedId: source.id, mode: 'single', clock };
}

/** The viewer's player as an InspectorClock (its time is the shared time). */
export function usePlayerClock(): InspectorClock {
  const player = usePlayer();
  return { getTime: () => player.getTime(), subscribe: player.subscribeTime, seek: (sharedMs) => player.seek(sharedMs) };
}

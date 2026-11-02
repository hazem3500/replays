import { type KeyboardEvent, useRef, useState } from 'react';

import type { ReplayBundle } from '../../../shared/replay.ts';
import type { Fidelity, MeetingClock } from './clock.ts';
import { cellAspect, gridRects, neighbour, type Placement, type Size, spotlightRects } from './layout.ts';
import { useElementSize } from '../../hooks/use-element-size.ts';
import { MeetingTile, type TileActions } from './MeetingTile.tsx';
import type { TileModel, TileSource } from './tiles.ts';

/** Grid tiles beyond this many play as low-rate thumbnails, except the one with focus. */
export const LIVE_BUDGET = 6;

export interface StageTile {
  source: TileSource;
  model: TileModel | undefined;
  bundle: ReplayBundle | undefined;
  failure: string;
  offset: number;
}

const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

export function placementsFor(count: number, pinIndex: number, box: Size, aspect: number): Placement[] {
  if (!(box.width > 0 && box.height > 0)) return [];
  if (pinIndex >= 0 && count > 1) return spotlightRects(count, pinIndex, box, aspect).placements;
  return gridRects(count, box, aspect).map((rect) => ({ ...rect, role: 'grid' as const }));
}

export function fidelityFor(placement: Placement | undefined, count: number, focused: boolean): Fidelity {
  if (!placement || placement.role === 'spotlight') return 'live';
  if (placement.role === 'strip') return focused ? 'live' : 'thumb';
  return count <= LIVE_BUDGET || focused ? 'live' : 'thumb';
}

/**
 * The tiles of a comparison, absolutely placed so a layout change (pin, hide, add, resize) only moves and resizes
 * each tile: it glides there, and a pinned tile morphs into the large view, without remounting its player.
 * Phones get a swipeable row of full-width tiles instead.
 */
export function MeetingStage({
  tiles,
  pin,
  muted,
  mobile,
  clock,
  actions,
  href,
  sheet,
  highlight,
  onTileFocus,
}: {
  tiles: StageTile[];
  pin: string | undefined;
  muted: ReadonlySet<string>;
  mobile: boolean;
  clock: MeetingClock;
  actions: Omit<TileActions, 'onFocus' | 'onKey' | 'onDrop'> & { onSwap(from: string, to: string): void; onUnpin(): void };
  href(id: string, seconds: number): string;
  sheet: boolean;
  /** The tile whose row is hovered in the diagnostics dock. */
  highlight?: string | undefined;
  /** A tile was clicked, focused or swiped to: the dock follows it. */
  onTileFocus?(id: string): void;
}) {
  const [focused, setFocused] = useState<string>();
  const [dragging, setDragging] = useState<string>();
  const measure = useRef<HTMLDivElement>(null);
  const box = useElementSize(measure);

  const aspect = cellAspect(tiles.map((tile) => tile.model?.aspect ?? Number.NaN));
  const pinIndex = tiles.findIndex((tile) => tile.source.id === pin);
  const placements = mobile ? [] : placementsFor(tiles.length, pinIndex, box, aspect);
  const current = tiles.some((tile) => tile.source.id === focused) ? focused : (pin ?? tiles[0]?.source.id);

  const focusTile = (id: string | undefined) => {
    if (!id) return;
    setFocused(id);
    const element = document.querySelector<HTMLElement>(`.mt-tile[data-tile-id="${CSS.escape(id)}"]`);
    element?.focus({ preventScroll: !mobile });
    if (mobile) element?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };

  const onKey = (id: string, event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && pin) {
      event.preventDefault();
      actions.onUnpin();
      focusTile(id);
      return;
    }
    if (event.target !== event.currentTarget) return;
    const index = tiles.findIndex((tile) => tile.source.id === id);
    if (ARROWS.has(event.key)) {
      event.preventDefault();
      const next = mobile
        ? index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1)
        : neighbour(placements, index, event.key as 'ArrowLeft');
      focusTile(tiles[Math.max(0, Math.min(tiles.length - 1, next))]?.source.id);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      actions.onPin(id);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusTile(tiles[event.key === 'Home' ? 0 : tiles.length - 1]?.source.id);
    }
  };

  return (
    <div
      ref={measure}
      className="mt-stage-area"
      data-layout={mobile ? 'carousel' : pinIndex >= 0 && tiles.length > 1 ? 'spotlight' : 'grid'}
      data-count={tiles.length}
      data-meeting-scroller=""
      onScroll={(event) => {
        if (!mobile) return;
        const area = event.currentTarget;
        const index = Math.round(area.scrollLeft / Math.max(1, area.clientWidth));
        const id = tiles[index]?.source.id;
        if (id) onTileFocus?.(id);
      }}
      role="group"
      aria-label="Recordings"
      aria-roledescription="comparison grid"
    >
      {tiles.map((tile, index) => {
        const placement = placements[index];
        const id = tile.source.id;
        return (
          <MeetingTile
            key={id}
            {...tile}
            clock={clock}
            placement={placement}
            fidelity={fidelityFor(placement, tiles.length, id === focused)}
            pinned={id === pin}
            muted={muted.has(id)}
            current={id === current}
            dragging={dragging}
            onDragState={setDragging}
            onPin={actions.onPin}
            onMute={actions.onMute}
            onHide={actions.onHide}
            onFocus={(focusedId) => {
              setFocused(focusedId);
              onTileFocus?.(focusedId);
            }}
            highlighted={id === highlight}
            onKey={onKey}
            onDrop={actions.onSwap}
            href={href}
            sheet={sheet}
          />
        );
      })}
    </div>
  );
}

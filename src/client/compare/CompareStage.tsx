import { type CSSProperties, useRef } from 'react';

import { useCarouselFocus } from '../hooks/use-carousel-focus.ts';
import { useStageBox } from '../hooks/use-stage-box.ts';
import type { Fidelity } from './clock.ts';
import { type Placement, placementsFor } from './layout.ts';
import type { CompareLayout } from './compare-search.ts';
import type { CompareSession } from './session.ts';
import { CompareTileView, type TileCommands } from './CompareTile.tsx';
import { PhoneSwitch } from './PhoneSwitch.tsx';
import { cellAspect, type CompareTile } from './tiles.ts';

/** The recordings' shared shape, so a stacked or phone viewer sizes the stage like its single player. */
interface StageStyle extends CSSProperties {
  '--stage-aspect': string;
}

/** Grid tiles beyond this many play as low-rate thumbnails, except the focused one. */
const LIVE_BUDGET = 6;

function fidelityFor(placement: Placement | undefined, count: number, focused: boolean, carousel: boolean): Fidelity {
  if (carousel) return focused ? 'live' : 'thumb';
  if (!placement || placement.role === 'hidden') return 'off';
  if (placement.role === 'spotlight' || placement.role === 'single' || focused) return 'live';
  if (placement.role === 'strip') return 'thumb';
  return count <= LIVE_BUDGET ? 'live' : 'thumb';
}

/**
 * The compared recordings in the viewer's stage. Every tile is absolutely placed, so a layout change (Single,
 * Grid, Spotlight, a new focus, a resize) only moves and resizes each one: it glides there and its player never
 * remounts. Phones get a row of full-width tiles to swipe through; the one in view is the focus.
 */
export function CompareStage({
  session,
  tiles,
  layout,
  focus,
  mobile,
  commands,
}: {
  session: CompareSession;
  tiles: readonly CompareTile[];
  layout: CompareLayout;
  focus: string;
  mobile: boolean;
  commands: TileCommands;
}) {
  const area = useRef<HTMLDivElement>(null);
  const switchRow = useRef<HTMLDivElement>(null);
  const box = useStageBox(area);
  const carousel = mobile && layout !== 'single' && tiles.length > 1;
  const focusIndex = Math.max(
    0,
    tiles.findIndex((tile) => tile.id === focus),
  );
  const placements = carousel ? [] : placementsFor({ layout, count: tiles.length, focus: focusIndex, box, aspect: cellAspect(tiles) });
  useCarouselFocus(area, carousel, focusIndex);
  const style: StageStyle = { '--stage-aspect': String(cellAspect(tiles)) };

  return (
    <>
      {carousel ? <PhoneSwitch ref={switchRow} tiles={tiles} focus={focus} onFocus={commands.onFocus} /> : null}
      <div
        ref={area}
        className="ct-area"
        id="replay-player"
        data-testid="compare-stage"
        data-layout={carousel ? 'carousel' : layout}
        data-count={tiles.length}
        data-resizing={box.resizing || undefined}
        style={style}
        tabIndex={-1}
        role="group"
        aria-label="Compared recordings"
        onScroll={(event) => {
          if (!carousel) return;
          const element = event.currentTarget;
          const position = element.scrollLeft / Math.max(1, element.clientWidth);
          switchRow.current?.style.setProperty('--swipe', String(position));
          // why: only the snapped tile a swipe settles on takes the focus; a glide the switch started is no swipe at all.
          if (element.hasAttribute('data-gliding') || Math.abs(position - Math.round(position)) > 0.02) return;
          const id = tiles[Math.round(position)]?.id;
          if (id && id !== focus) commands.onFocus(id);
        }}
      >
        {tiles.map((tile, index) => {
          const placement = placements[index];
          const focused = tile.id === focus;
          return (
            <CompareTileView
              key={tile.id}
              session={session}
              tile={tile}
              placement={placement}
              focused={focused}
              alone={tiles.length === 1}
              fidelity={fidelityFor(placement, tiles.length, focused, carousel)}
              commands={commands}
            />
          );
        })}
      </div>
    </>
  );
}

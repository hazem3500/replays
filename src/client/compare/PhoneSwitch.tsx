import { MaximizeIcon } from 'lucide-react';
import type { CSSProperties, KeyboardEvent, Ref } from 'react';

import { IconButton } from '@/components/icon-button.tsx';
import { plural } from '../plural.ts';
import { useViewer } from '../viewer/context.ts';
import { Identity } from './Identity.tsx';
import type { CompareTile } from './tiles.ts';

const PHONE_STRINGS = {
  group: 'Recording on show',
  option: (name: string, errors: number) => (errors ? `${name}, ${plural(errors, 'error')}` : name),
  fullscreen: 'Fullscreen',
} as const;

/** Beyond this many recordings the segments are colour dots, with the chosen recording's name beside them. */
const NAMED_SEGMENTS_MAX = 4;

const ARROW_STEPS: Partial<Record<string, number>> = { ArrowRight: 1, ArrowLeft: -1 };

/** `--swipe` is the stage's scroll position in tiles (0 at the first): the thumb sits under it while a finger drags. */
interface SwitchStyle extends CSSProperties {
  '--count': number;
  '--swipe': number;
}

/**
 * Phones show one recording at a time: this row above the stage names each one (colour, name, error count) and says
 * which is on show. Its thumb slides with the swipe, a tap slides the stage, and arrow keys move it, so touch,
 * keyboard and screen readers share one control. Fullscreen, the stage's one control, sits at its end, off the page.
 */
export function PhoneSwitch({
  ref,
  tiles,
  focus,
  onFocus,
}: {
  ref?: Ref<HTMLDivElement>;
  tiles: readonly CompareTile[];
  focus: string;
  onFocus: (id: string) => void;
}) {
  const { switchFullscreen } = useViewer();
  const index = Math.max(
    0,
    tiles.findIndex((tile) => tile.id === focus),
  );
  const named = tiles.length <= NAMED_SEGMENTS_MAX;
  const current = tiles[index];
  const style: SwitchStyle = { '--count': tiles.length, '--swipe': index };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = ARROW_STEPS[event.key] ?? 0;
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    const next = tiles[(index + step + tiles.length) % tiles.length];
    if (!next) return;
    const group = event.currentTarget.closest('[role="radiogroup"]');
    onFocus(next.id);
    requestAnimationFrame(() => group?.querySelector<HTMLElement>(`[data-scope="${CSS.escape(next.id)}"]`)?.focus());
  };

  return (
    <div ref={ref} className="ct-phone-switch" data-testid="phone-switch" data-named={named || undefined} style={style}>
      <div className="ct-phone-segments" role="radiogroup" aria-label={PHONE_STRINGS.group}>
        <span className="ct-phone-thumb" aria-hidden="true" />
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            role="radio"
            className="ct-phone-segment"
            data-scope={tile.id}
            aria-checked={tile.id === focus}
            aria-label={PHONE_STRINGS.option(tile.name, tile.errors)}
            tabIndex={tile.id === focus ? 0 : -1}
            disabled={!tile.bundle}
            onClick={() => onFocus(tile.id)}
            onKeyDown={onKeyDown}
          >
            {named ? <Identity tile={tile} /> : <span className="ct-swatch" data-tile={tile.colour} aria-hidden="true" />}
            {named && tile.errors ? (
              <span className="ct-phone-errors" aria-hidden="true">
                {tile.errors}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {!named && current ? (
        <span className="ct-phone-current" aria-hidden="true">
          <Identity tile={current} />
        </span>
      ) : null}
      <IconButton label={PHONE_STRINGS.fullscreen} className="ct-phone-fullscreen" onClick={switchFullscreen}>
        <MaximizeIcon aria-hidden="true" />
      </IconButton>
    </div>
  );
}

import { ChevronDownIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Identity } from './Identity.tsx';
import type { CompareTile } from './tiles.ts';

const SCOPE_STRINGS = {
  showing: 'Showing',
  group: 'Recording the panels show',
  choose: (name: string) => `Showing ${name}. Choose another recording`,
} as const;

/** More than this many recordings, or names longer than this together, and the segments become one menu. */
const SEGMENTS_MAX = 3;
const SEGMENT_CHARACTERS_MAX = 36;

const ARROW_STEPS: Partial<Record<string, number>> = { ArrowRight: 1, ArrowLeft: -1 };

/**
 * At the end of the inspector's tab row: which compared recording the panels, steps and seek-bar markers show,
 * by name. A few short names are a segmented control; more become one menu. Switching never touches the stage's
 * layout or players; clicking a tile does the same.
 */
export function ScopeSwitch({ tiles, focus, onFocus }: { tiles: readonly CompareTile[]; focus: string; onFocus: (id: string) => void }) {
  const characters = tiles.reduce((total, tile) => total + tile.name.length, 0);
  const segmented = tiles.length <= SEGMENTS_MAX && characters <= SEGMENT_CHARACTERS_MAX;
  return (
    <div className="ct-scope" data-testid="compare-scope">
      <span className="ct-scope-label" aria-hidden="true">
        {SCOPE_STRINGS.showing}
      </span>
      {segmented ? (
        <ScopeSegments tiles={tiles} focus={focus} onFocus={onFocus} />
      ) : (
        <ScopeMenu tiles={tiles} focus={focus} onFocus={onFocus} />
      )}
    </div>
  );
}

function ScopeSegments({ tiles, focus, onFocus }: { tiles: readonly CompareTile[]; focus: string; onFocus: (id: string) => void }) {
  const index = tiles.findIndex((tile) => tile.id === focus);
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
    <div className="ct-segments" role="radiogroup" aria-label={SCOPE_STRINGS.group}>
      {tiles.map((tile) => (
        <button
          key={tile.id}
          type="button"
          role="radio"
          className="ct-segment"
          data-scope={tile.id}
          aria-checked={tile.id === focus}
          tabIndex={tile.id === focus ? 0 : -1}
          disabled={!tile.bundle}
          title={tile.label}
          onClick={() => onFocus(tile.id)}
          onKeyDown={onKeyDown}
        >
          <Identity tile={tile} />
        </button>
      ))}
    </div>
  );
}

function ScopeMenu({ tiles, focus, onFocus }: { tiles: readonly CompareTile[]; focus: string; onFocus: (id: string) => void }) {
  const current = tiles.find((tile) => tile.id === focus) ?? tiles[0];
  if (!current) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" className="ct-scope-trigger" aria-label={SCOPE_STRINGS.choose(current.name)} title={current.label} />}
      >
        <Identity tile={current} />
        <ChevronDownIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-auto min-w-48">
        <DropdownMenuRadioGroup value={current.id} onValueChange={(id) => onFocus(String(id))}>
          {tiles.map((tile) => (
            <DropdownMenuRadioItem key={tile.id} value={tile.id} disabled={!tile.bundle} title={tile.label}>
              <Identity tile={tile} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

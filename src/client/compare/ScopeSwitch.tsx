import type { KeyboardEvent } from 'react';

import { Hint } from '@/components/icon-button.tsx';
import type { CompareTile } from './tiles.ts';

const SCOPE_STRINGS = {
  group: 'Recording the panels describe',
  hint: (letter: string, label: string) => `${letter}: ${label}`,
} as const;

const ARROW_STEPS: Partial<Record<string, number>> = { ArrowRight: 1, ArrowLeft: -1 };

/**
 * At the end of the inspector's tab row: which compared recording the panels, steps and seek-bar markers describe.
 * Switching scope never touches the stage's layout or players; clicking a tile does the same.
 */
export function ScopeSwitch({ tiles, focus, onFocus }: { tiles: readonly CompareTile[]; focus: string; onFocus: (id: string) => void }) {
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
    <div className="ct-scope" role="radiogroup" aria-label={SCOPE_STRINGS.group} data-testid="compare-scope">
      {tiles.map((tile) => (
        <Hint key={tile.id} label={SCOPE_STRINGS.hint(tile.letter, tile.label)} side="top">
          <button
            type="button"
            role="radio"
            className="ct-scope-option"
            data-scope={tile.id}
            aria-checked={tile.id === focus}
            aria-label={SCOPE_STRINGS.hint(tile.letter, tile.label)}
            tabIndex={tile.id === focus ? 0 : -1}
            disabled={!tile.bundle}
            data-tile={tile.colour}
            onClick={() => onFocus(tile.id)}
            onKeyDown={onKeyDown}
          >
            <span className="ct-chip" aria-hidden="true">
              {tile.letter}
            </span>
          </button>
        </Hint>
      ))}
    </div>
  );
}

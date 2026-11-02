import { type CSSProperties, type KeyboardEvent, useRef } from 'react';

import type { DockSource } from './MeetingDock.tsx';

export const SOURCES_STRINGS = {
  label: 'Recording the diagnostics show',
  showing: 'Showing',
} as const;

/**
 * Which recording the dock shows, as chips in the tiles' scrubber colours: flipping it never changes the layout.
 * One radio group (arrow keys move the choice, one tab stop).
 */
export function DockSources({
  sources,
  focusedId,
  onFocus,
}: {
  sources: readonly DockSource[];
  focusedId: string;
  onFocus(id: string): void;
}) {
  const group = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = sources.findIndex((source) => source.id === focusedId);
    const next = sources[(index + step + sources.length) % sources.length];
    if (!next) return;
    onFocus(next.id);
    requestAnimationFrame(() => group.current?.querySelector<HTMLElement>(`[data-source-id="${CSS.escape(next.id)}"]`)?.focus());
  };
  return (
    <div className="mt-dock-sources">
      <span className="mt-dock-showing" aria-hidden="true">
        {SOURCES_STRINGS.showing}
      </span>
      <div ref={group} role="radiogroup" aria-label={SOURCES_STRINGS.label} className="mt-dock-chips" onKeyDown={onKeyDown}>
        {sources.map((source) => {
          const checked = source.id === focusedId;
          return (
            <button
              key={source.id}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              className="mt-dock-chip"
              data-source-id={source.id}
              style={{ '--tile': `var(--tile-${source.colourIndex + 1})` } as CSSProperties}
              onClick={() => onFocus(source.id)}
            >
              <span className="mt-letter" aria-hidden="true">
                {source.letter}
              </span>
              <span className="mt-dock-chip-label">{source.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

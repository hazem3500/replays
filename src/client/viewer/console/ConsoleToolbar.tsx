import { usePanelSearchMotion } from '../../hooks/use-panel-search-motion.ts';
import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { type KeyboardEvent as ReactKeyboardEvent, useRef, useState } from 'react';

import type { LevelFilter } from './model.ts';

const LEVEL_CHIPS: ReadonlyArray<{ id: LevelFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'error', label: 'Errors' },
  { id: 'warn', label: 'Warnings' },
  { id: 'info', label: 'Info' },
  { id: 'debug', label: 'Debug' },
];

const STRINGS = {
  levels: 'Show messages',
  search: 'Search messages',
  closeSearch: 'Close search',
  placeholder: 'Text in the message or page',
  shown: (shown: number) => `${shown} ${shown === 1 ? 'message' : 'messages'}`,
  infoHint: 'Info and log',
};

const keepKeys = (event: ReactKeyboardEvent<HTMLElement>) => {
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) event.stopPropagation();
};

/**
 * One row, as Network's: the level chips are the filters and the summary (All 14 · Errors 3 · Warnings 2), and
 * search opens in place of the chips instead of adding a row.
 */
export function ConsoleToolbar({
  counts,
  level,
  text,
  shown,
  onLevel,
  onText,
}: {
  counts: Readonly<Record<LevelFilter, number>>;
  level: LevelFilter;
  text: string;
  /** Messages left after filtering. */
  shown: number;
  onLevel: (level: LevelFilter) => void;
  onText: (text: string) => void;
}) {
  const [searching, setSearching] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeSearch = () => {
    onText('');
    setSearching(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  return (
    <div className="np-toolbar" data-searching={searching || undefined}>
      <div className="np-chips" role="group" aria-label={STRINGS.levels}>
        {LEVEL_CHIPS.filter((chip) => chip.id === 'all' || counts[chip.id] > 0 || chip.id === level).map((chip) => (
          <button
            key={chip.id}
            type="button"
            className="np-chip"
            data-level={chip.id}
            data-testid={`console-level-${chip.id}`}
            aria-pressed={level === chip.id}
            title={chip.id === 'info' ? STRINGS.infoHint : undefined}
            onClick={() => onLevel(level === chip.id ? 'all' : chip.id)}
            onKeyDown={keepKeys}
          >
            {chip.id === 'all' ? null : <span className="cp-dot" data-level={chip.id} aria-hidden="true" />}
            {chip.label}
            <span className="np-chip-count">{counts[chip.id]}</span>
          </button>
        ))}
      </div>
      <span className="np-spacer" />
      {shown === counts.all ? null : (
        <span className="np-shown" aria-live="polite">
          {STRINGS.shown(shown)}
        </span>
      )}
      {searching ? (
        <SearchField text={text} onText={onText} onClose={closeSearch} />
      ) : (
        <button
          ref={trigger}
          type="button"
          className="np-icon"
          aria-label={STRINGS.search}
          data-active={text ? '' : undefined}
          data-testid="console-search-toggle"
          onClick={() => setSearching(true)}
          onKeyDown={keepKeys}
        >
          <AnimatedIcon name="search" />
        </button>
      )}
    </div>
  );
}

function SearchField({ text, onText, onClose }: { text: string; onText: (text: string) => void; onClose: () => void }) {
  const ref = usePanelSearchMotion();
  return (
    <label ref={ref} className="np-search">
      <AnimatedIcon name="search" />
      <span className="visually-hidden">{STRINGS.search}</span>
      <input
        type="search"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- why: the field appears because its button was pressed; focus belongs there.
        autoFocus
        placeholder={STRINGS.placeholder}
        value={text}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') onClose();
        }}
      />
      <button type="button" className="np-icon" aria-label={STRINGS.closeSearch} onClick={onClose} onKeyDown={keepKeys}>
        <AnimatedIcon name="x" />
      </button>
    </label>
  );
}

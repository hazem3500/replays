import { CheckIcon, SearchIcon } from 'lucide-react';
import { type Ref, useRef, useState } from 'react';
import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { SurfaceMotion } from '@/components/ui/surface-motion.tsx';

import { moveFocusWithKeys } from './focus.ts';
import { type Choice, filterStrings } from './model.ts';

const SEARCH_OPTIONS_PAST = 8;

function SearchField({
  label,
  value,
  onChange,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputRef: Ref<HTMLInputElement>;
}) {
  return (
    <div className="filter-search-field">
      <SearchIcon aria-hidden="true" />
      <input
        ref={inputRef}
        className="filter-search"
        aria-label={filterStrings.searchLabel(label)}
        placeholder={filterStrings.searchPlaceholder(label)}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          event.currentTarget.closest('.filter-pane')?.querySelector<HTMLElement>('[role="option"]')?.focus();
        }}
      />
    </div>
  );
}

/** One pane per choice filter (Host, Tag, …): a command list with a leading check, searchable when long. */
export function ChoiceOptions({ choice, onBack, direction }: { choice: Choice; onBack: () => void; direction: 'forward' | 'backward' }) {
  const [query, setQuery] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const searchable = choice.key === 'host' || choice.key === 'tag' || choice.options.length > SEARCH_OPTIONS_PAST;
  const options = choice.options.filter((option) => !searchable || option.label.toLowerCase().includes(query.toLowerCase()));
  const selectedVisible = options.some((option) => option.value === choice.value);
  const choose = (value?: string) => {
    choice.onChange(value);
    onBack();
  };
  return (
    <SurfaceMotion
      open
      kind="pane"
      className="filter-pane"
      data-panel-direction={direction}
      data-side={direction === 'backward' ? 'left' : 'right'}
    >
      <div className="filter-choice-head">
        <button type="button" className="filter-back" onClick={onBack} aria-label={filterStrings.back}>
          <AnimatedIcon name="chevron-left" />
        </button>
        <span className="filter-menu-title">{choice.label}</span>
        {choice.value !== undefined ? (
          <button type="button" className="filter-menu-clear filter-choice-reset" onClick={() => choose()}>
            {filterStrings.reset}
          </button>
        ) : null}
      </div>
      {searchable ? <SearchField label={choice.label} value={query} onChange={setQuery} inputRef={searchInput} /> : null}
      {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- why: focus lives on the options; the list only routes their arrow keys. */}
      <div
        className="filter-choice-list"
        role="listbox"
        aria-label={choice.label}
        onKeyDown={(event) => {
          const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];
          if (moveFocusWithKeys(event.key, items, document.activeElement)) event.preventDefault();
        }}
      >
        {options.map((option, index) => {
          const selected = option.value === choice.value;
          return (
            <button
              type="button"
              key={option.label}
              role="option"
              aria-selected={selected}
              className="filter-choice-option"
              data-reset={option.value === undefined || undefined}
              tabIndex={selected || (index === 0 && !selectedVisible) ? 0 : -1}
              onClick={() => choose(option.value)}
            >
              <span className="filter-choice-check" aria-hidden="true">
                {selected ? <CheckIcon /> : null}
              </span>
              <span className="filter-choice-label">{option.label}</span>
            </button>
          );
        })}
      </div>
      {options.length ? null : (
        <div className="filter-empty" role="status">
          {filterStrings.noMatch(choice.label)}
          <button
            type="button"
            className="filter-menu-clear"
            onClick={() => {
              setQuery('');
              searchInput.current?.focus();
            }}
          >
            {filterStrings.clearSearch}
          </button>
        </div>
      )}
    </SurfaceMotion>
  );
}

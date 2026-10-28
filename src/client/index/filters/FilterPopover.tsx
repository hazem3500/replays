import { ChevronRightIcon } from 'lucide-react';
import { type KeyboardEvent, useRef, useState } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';

import { usePluginSnapshot } from '../../plugins/PluginUi.tsx';
import { ChoiceOptions } from './ChoiceOptions.tsx';
import { focusSoon, moveFocusWithKeys, rowSelector } from './focus.ts';
import { ChoiceIcon, FilterRows } from './FilterRows.tsx';
import { FilterTokens } from './FilterTokens.tsx';
import {
  activeFilters,
  activeFilterTokens,
  type Choice,
  choicesOf,
  type FilterState,
  type FilterToken,
  filterRows,
  filterStrings,
  valueLabel,
} from './model.ts';

const MENU = '[data-filter-menu]';
const PANE_TARGETS = ['.filter-search', '[role="option"][aria-selected="true"]', '[role="option"]'];

function ChoiceRow({ choice, onOpen }: { choice: Choice; onOpen: (key: string) => void }) {
  return (
    <button
      type="button"
      data-filter-key={choice.key}
      className="filter-row"
      data-active={choice.value !== undefined || undefined}
      data-testid={choice.testId}
      onClick={() => onOpen(choice.key)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowRight') return;
        event.preventDefault();
        onOpen(choice.key);
      }}
    >
      <ChoiceIcon name={choice.key} />
      <span className="filter-row-label">{choice.label}</span>
      <span className="filter-row-value">{valueLabel(choice)}</span>
      <ChevronRightIcon className="filter-chevron" aria-hidden="true" />
    </button>
  );
}

function FilterTrigger({ active }: { active: number }) {
  return (
    <PopoverTrigger className="scope-button" aria-label={filterStrings.trigger(active)}>
      <AnimatedIcon name="sliders-horizontal" />
      {filterStrings.filter}
      {active ? (
        <span className="scope-badge" aria-hidden="true">
          {active}
        </span>
      ) : null}
    </PopoverTrigger>
  );
}

function firstTarget(selectors: readonly string[] | undefined) {
  const popup = document.querySelector<HTMLElement>(MENU);
  for (const selector of selectors ?? []) {
    const target = popup?.querySelector<HTMLElement>(selector);
    if (target) return target;
  }
  return true;
}

function targetsFor(token: FilterToken | undefined) {
  if (token?.pane) return PANE_TARGETS;
  return token ? [rowSelector(token.rowKey)] : undefined;
}

function handleMenuKeys(event: KeyboardEvent<HTMLElement>, inPane: boolean, leavePane: () => void) {
  if (!inPane && event.target instanceof HTMLButtonElement && event.target.matches('.filter-row')) {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button.filter-row')];
    if (moveFocusWithKeys(event.key, buttons, event.target)) event.preventDefault();
  }
  if (inPane && (event.key === 'Escape' || (event.key === 'ArrowLeft' && !(event.target instanceof HTMLInputElement)))) {
    event.preventDefault();
    event.stopPropagation();
    leavePane();
  }
}

/** Desktop: the active filters as tokens, then one quiet "Filter" button (icon, label, count) opening the menu. */
export function FilterMenu(state: FilterState) {
  const active = activeFilters(state);
  const plugins = usePluginSnapshot().filters;
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<string>();
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  // why: where the keyboard lands when a token (not the button) opens the menu.
  const initialTarget = useRef<readonly string[] | undefined>(undefined);
  const rows = filterRows(state, plugins);
  const selected = choicesOf(rows).find((choice) => choice.key === panel);
  const openPanel = (key: string) => {
    setDirection('forward');
    setPanel(key);
    focusSoon(MENU, PANE_TARGETS);
  };
  const returnToFilters = () => {
    setDirection('backward');
    setPanel(undefined);
    if (panel) focusSoon(MENU, [rowSelector(panel)]);
  };
  const openAt = (token?: FilterToken) => {
    setDirection('forward');
    setPanel(token?.pane);
    initialTarget.current = targetsFor(token);
    setOpen(true);
  };

  return (
    <>
      <FilterTokens tokens={activeFilterTokens(state, plugins)} onOpen={openAt} onClear={state.clearFilters} />
      <Popover
        open={open}
        onOpenChange={(next, details) => {
          // why: Base UI sees Escape before the popup's React handler; the first Escape must leave a pane, only the second closes.
          if (!next && panel && details.reason === 'escape-key') {
            details.cancel();
            returnToFilters();
            return;
          }
          setOpen(next);
          if (!next) setPanel(undefined);
        }}
      >
        <FilterTrigger active={active} />
        <PopoverContent
          data-filter-menu=""
          align="end"
          className="filter-menu"
          aria-label={selected ? filterStrings.filterBy(selected.label) : filterStrings.filters}
          initialFocus={() => {
            const targets = initialTarget.current;
            initialTarget.current = undefined;
            return firstTarget(targets);
          }}
          onKeyDown={(event) => handleMenuKeys(event, Boolean(selected), returnToFilters)}
        >
          {selected ? (
            <ChoiceOptions key={selected.key} choice={selected} direction={direction} onBack={returnToFilters} />
          ) : (
            <div key="filters" className="filter-pane" data-panel-direction={direction}>
              <div className="filter-menu-head">
                <span className="filter-menu-title">{filterStrings.filters}</span>
                {active ? (
                  <button type="button" className="filter-menu-clear" onClick={state.clearFilters}>
                    {filterStrings.clearAll}
                  </button>
                ) : null}
              </div>
              <FilterRows rows={rows} state={state} renderChoice={(choice) => <ChoiceRow choice={choice} onOpen={openPanel} />} />
            </div>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}

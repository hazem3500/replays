import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useState } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Drawer, DrawerClose, DrawerContent, DrawerFooter, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer.tsx';

import { usePluginSnapshot } from '../../plugins/PluginUi.tsx';
import { focusSoon, rowSelector } from './focus.ts';
import { FilterRows } from './FilterRows.tsx';
import { activeFilters, type Choice, choicesOf, type FilterState, filterRows, filterStrings, valueLabel } from './model.ts';

const SHEET = '.filter-sheet';

function ChoicePanel({ choice, onBack }: { choice: Choice; onBack: (chose: boolean) => void }) {
  return (
    <>
      <div className="filter-menu-head filter-panel-head filter-pane">
        <button type="button" className="filter-back" aria-label={filterStrings.back} onClick={() => onBack(false)}>
          <ChevronLeftIcon aria-hidden="true" />
        </button>
        {/* why: the sheet keeps its name ("Filters"); the panel's own heading says which filter. */}
        <DrawerTitle className="visually-hidden">{filterStrings.filters}</DrawerTitle>
        <span className="filter-menu-title">{choice.label}</span>
      </div>
      <div className="filter-options filter-pane" role="radiogroup" aria-label={choice.label}>
        {choice.options.map((option) => {
          const checked = option.value === choice.value;
          return (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={checked}
              className="filter-row filter-option"
              onClick={() => {
                onBack(true);
                choice.onChange(option.value);
              }}
            >
              <span className="filter-row-label">{option.label}</span>
              {checked ? <CheckIcon className="filter-check" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Phones: a 44 px "Filters" button (the active count inside it) opening a bottom sheet; a choice opens a second panel in place. */
export function FilterSheet(state: FilterState) {
  const active = activeFilters(state);
  const [panel, setPanel] = useState<Choice['key']>();
  const plugins = usePluginSnapshot().filters;
  const rows = filterRows(state, plugins);
  const open = choicesOf(rows).find((choice) => choice.key === panel);
  const changePanel = (next: Choice['key'] | undefined) => {
    // why: the trigger row unmounts when the options mount; parking focus on the popup keeps Base UI's focus scope alive.
    document.querySelector<HTMLElement>(SHEET)?.focus();
    const previous = panel;
    setPanel(next);
    if (next) focusSoon(SHEET, ['[role="radio"][aria-checked="true"]', '[role="radio"]']);
    else if (previous) focusSoon(SHEET, [rowSelector(previous)]);
  };
  return (
    <Drawer onOpenChange={(next) => (next ? undefined : setPanel(undefined))}>
      <DrawerTrigger className="index-filters-button" aria-label={filterStrings.sheetTrigger(active)}>
        <AnimatedIcon name="sliders-horizontal" />
        <span className="index-filters-label" aria-hidden="true">
          {filterStrings.filters}
        </span>
        {/* why: the count sits inside the button, beside its label; a badge on the icon's corner read as a notification. */}
        {active ? (
          <span className="index-filters-count" aria-hidden="true">
            {active}
          </span>
        ) : null}
      </DrawerTrigger>
      <DrawerContent
        className="filter-sheet"
        onKeyDownCapture={(event) => {
          if (panel && (event.key === 'Escape' || event.key === 'ArrowLeft')) {
            event.preventDefault();
            event.stopPropagation();
            changePanel(undefined);
          }
        }}
      >
        {open ? (
          <ChoicePanel choice={open} onBack={() => changePanel(undefined)} />
        ) : (
          <>
            <div className="filter-menu-head">
              <DrawerTitle className="filter-menu-title">{filterStrings.filters}</DrawerTitle>
              {active ? (
                <button type="button" className="filter-menu-clear" onClick={state.clearFilters}>
                  {filterStrings.clear}
                </button>
              ) : null}
            </div>
            <FilterRows
              rows={rows}
              state={state}
              renderChoice={(choice) => (
                <button
                  type="button"
                  className="filter-row"
                  data-filter-key={choice.key}
                  data-active={choice.value !== undefined || undefined}
                  aria-label={`${choice.label}: ${valueLabel(choice)}`}
                  data-testid={choice.testId}
                  onClick={() => changePanel(choice.key)}
                >
                  <span className="filter-row-label">{choice.label}</span>
                  <span className="filter-row-value">{valueLabel(choice)}</span>
                  <ChevronRightIcon className="filter-chevron" aria-hidden="true" />
                </button>
              )}
            />
          </>
        )}
        <DrawerFooter className="sheet-footer">
          <DrawerClose render={<Button variant="secondary" className="h-[44px] w-full text-[13px]" />}>{filterStrings.done}</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

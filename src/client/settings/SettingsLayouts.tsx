import { ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';

import { DialogClose, DialogTitle } from '@/components/ui/dialog.tsx';

import type { SettingsSectionDescriptor, SettingsSectionId } from './sections.tsx';
import { strings } from './strings.ts';

export function CloseButton() {
  return (
    <DialogClose render={<button type="button" className="settings-close" aria-label={strings.close} />}>
      <XIcon aria-hidden="true" />
    </DialogClose>
  );
}

function nextIndex(key: string, index: number, count: number) {
  if (key === 'ArrowDown' || key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowUp' || key === 'ArrowLeft') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return -1;
}

/** Desktop: a vertical tablist (one tab stop, arrows/Home/End select) beside the selected section. */
export function SplitLayout({
  sections,
  current,
  instant,
  onSelect,
}: {
  sections: readonly SettingsSectionDescriptor[];
  current: SettingsSectionDescriptor;
  /** Keyboard switches skip the pane fade: they repeat quickly. */
  instant: boolean;
  onSelect: (section: SettingsSectionId, viaKeyboard: boolean) => void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const next = nextIndex(event.key, sections.indexOf(current), sections.length);
    const target = sections[next];
    if (!target) return;
    event.preventDefault();
    onSelect(target.section, true);
    event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-slot-item="${target.id}"]`)?.focus();
  }
  return (
    <>
      <aside className="settings-sidebar">
        <DialogTitle className="settings-title">{strings.title}</DialogTitle>
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label={strings.sectionsLabel}
          className="settings-tabs"
          data-slot="settings.sections"
        >
          {sections.map((candidate) => {
            const Icon = candidate.icon;
            const selected = candidate === current;
            return (
              <button
                key={candidate.id}
                type="button"
                role="tab"
                id={`settings-tab-${candidate.section}`}
                aria-selected={selected}
                aria-controls="settings-panel"
                tabIndex={selected ? 0 : -1}
                className="settings-tab"
                data-slot-item={candidate.id}
                onClick={() => onSelect(candidate.section, false)}
                onKeyDown={onKeyDown}
              >
                <Icon className="settings-tab-icon" aria-hidden="true" />
                {candidate.label}
              </button>
            );
          })}
        </div>
      </aside>
      <div
        className="settings-pane"
        role="tabpanel"
        id="settings-panel"
        aria-labelledby={`settings-tab-${current.section}`}
        data-section={current.id}
      >
        <header className="settings-pane-header">
          <h2 className="settings-pane-title">{current.label}</h2>
          <CloseButton />
        </header>
        <div key={current.id} className="settings-pane-body" data-instant={instant || undefined}>
          {current.render({ stacked: false })}
        </div>
      </div>
    </>
  );
}

/** Phones, first screen: the sections as 48 px rows with chevrons. */
export function StackedList({
  sections,
  onOpen,
}: {
  sections: readonly SettingsSectionDescriptor[];
  onOpen: (section: SettingsSectionId, viaKeyboard: boolean) => void;
}) {
  return (
    <>
      <header className="settings-header">
        <DialogTitle className="settings-title">{strings.title}</DialogTitle>
        <CloseButton />
      </header>
      <nav className="settings-nav" aria-label={strings.sectionsLabel} data-slot="settings.sections">
        {sections.map((candidate) => {
          const Icon = candidate.icon;
          return (
            <button
              key={candidate.id}
              type="button"
              className="settings-nav-row"
              data-slot-item={candidate.id}
              onClick={(event) => onOpen(candidate.section, event.detail === 0)}
            >
              <Icon className="settings-nav-icon" aria-hidden="true" />
              <span className="settings-nav-label">{candidate.label}</span>
              <ChevronRightIcon className="settings-nav-chevron" aria-hidden="true" />
            </button>
          );
        })}
      </nav>
    </>
  );
}

/** Phones, pushed: one section with Back to the list. */
export function StackedSection({ current, onBack }: { current: SettingsSectionDescriptor; onBack: (viaKeyboard: boolean) => void }) {
  return (
    <>
      <header className="settings-header">
        <button type="button" className="settings-back" aria-label={strings.backLabel} onClick={(event) => onBack(event.detail === 0)}>
          <ChevronLeftIcon aria-hidden="true" />
          <span>{strings.back}</span>
        </button>
        <DialogTitle className="sr-only">{strings.title}</DialogTitle>
        <CloseButton />
      </header>
      <div className="settings-pane" data-section={current.id}>
        <h2 className="settings-pane-title">{current.label}</h2>
        <div key={current.id} className="settings-pane-body">
          {current.render({ stacked: true })}
        </div>
      </div>
    </>
  );
}

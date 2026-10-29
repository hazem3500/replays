import { SettingsIcon } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';

import { Hint } from '@/components/icon-button.tsx';
import { Button } from '@/components/ui/button.tsx';
import { DialogTrigger } from '@/components/ui/dialog.tsx';

import { currentSearchParam, dropSearchParam } from '../routing/navigate.ts';
import { isSettingsSection, type SettingsSectionId } from './sections.tsx';
import { SettingsDialog } from './SettingsDialog.tsx';
import { strings } from './strings.ts';

export type { SettingsSectionId } from './sections.tsx';
export { SettingsDialog } from './SettingsDialog.tsx';

/** `?settings=<section>` opens Settings on that section; closing removes it. */
const SEARCH_PARAM = 'settings';

interface SettingsState {
  open: boolean;
  section: SettingsSectionId;
  /** Phones: the button starts at the section list; a caller opening one section goes straight to it. */
  showList: boolean;
}

let state: SettingsState = { open: false, section: 'cli', showList: true };
const listeners = new Set<() => void>();

function setState(next: Partial<SettingsState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Open Settings, optionally on one section (`openSettings('labs')`). Needs a mounted SettingsButton. */
export function openSettings(section?: SettingsSectionId) {
  setState({ open: true, ...(section ? { section, showList: false } : { showList: true }) });
}

export function closeSettings() {
  setState({ open: false });
}

function applyDeepLink() {
  const value = currentSearchParam(SEARCH_PARAM);
  if (value === null || (state.open && state.section === value)) return;
  state = { open: true, section: isSettingsSection(value) ? value : 'cli', showList: false };
}

/** The account button in the top bar and the Settings dialog it opens. */
export function SettingsButton() {
  // why: an initializer runs before the first snapshot, so a deep link opens on first paint without an effect.
  useState(applyDeepLink);
  const current = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  return (
    <SettingsDialog
      open={current.open}
      section={current.section}
      showList={current.showList}
      onSectionChange={(section) => setState({ section })}
      onOpenChange={(open) => {
        setState(open ? { open, showList: true } : { open });
        if (!open) dropSearchParam(SEARCH_PARAM);
      }}
      trigger={
        <Hint label={strings.open} side="bottom" align="end">
          <DialogTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={strings.open}
                className="text-[var(--text-secondary)] hover:text-foreground"
              />
            }
          >
            <SettingsIcon className="size-4" aria-hidden="true" />
          </DialogTrigger>
        </Hint>
      }
    />
  );
}

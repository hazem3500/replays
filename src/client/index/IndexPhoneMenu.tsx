import { MoonIcon, SettingsIcon, SunIcon, UploadIcon, UserRoundIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Drawer, DrawerClose, DrawerContent, DrawerFooter, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer.tsx';

import { productName } from '../config.ts';
import { openSettings } from '../settings/Settings.tsx';
import { type Theme, useThemeControls } from '../theme.tsx';
import './index-phone-menu.css';

/*
 * Phones: the index header keeps two actions, search and this one. Upload, the theme and Settings fold into one
 * bottom sheet (thumb-reachable, 52 px rows) instead of four 40 px icons crowding the product name.
 * Upload and Settings open their own dialogs (still mounted by the header), after the sheet has closed.
 */

const strings = {
  trigger: 'Menu',
  upload: 'Upload a replay',
  uploadHint: '.json or .json.gz recording',
  settings: 'Settings',
  settingsHint: 'Preferences, shortcuts, CLI setup',
  appearance: 'Appearance',
  done: 'Done',
  themes: { light: 'Light', dark: 'Dark' } satisfies Record<Theme, string>,
};

export interface IndexPhoneMenuItem {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  onSelect: () => void;
}

/** The sheet's rows: the built-ins, then any the page adds (`items`). */
export function phoneMenuItems({ onUpload }: { onUpload?: () => void }): IndexPhoneMenuItem[] {
  return [
    ...(onUpload ? [{ id: 'upload', label: strings.upload, hint: strings.uploadHint, icon: <UploadIcon />, onSelect: onUpload }] : []),
    { id: 'settings', label: strings.settings, hint: strings.settingsHint, icon: <SettingsIcon />, onSelect: () => openSettings() },
  ];
}

function ThemeChoice() {
  const { theme, switchTheme } = useThemeControls();
  return (
    <div className="phone-menu-theme" data-slot="phone-menu-theme">
      <span className="phone-menu-theme-label" id="phone-menu-appearance">
        {strings.appearance}
      </span>
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- why: two toggles, not a fieldset. */}
      <div className="phone-menu-segments" role="group" aria-labelledby="phone-menu-appearance">
        {(['light', 'dark'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={theme === option}
            className="phone-menu-segment"
            data-slot-item="theme"
            onClick={() => (theme === option ? undefined : switchTheme())}
          >
            {option === 'light' ? <SunIcon aria-hidden="true" /> : <MoonIcon aria-hidden="true" />}
            {strings.themes[option]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function IndexPhoneMenu({ items }: { items: IndexPhoneMenuItem[] }) {
  return (
    <Drawer>
      <DrawerTrigger className="phone-menu-trigger" aria-label={strings.trigger}>
        <UserRoundIcon aria-hidden="true" />
      </DrawerTrigger>
      <DrawerContent className="phone-menu-sheet">
        <DrawerTitle className="phone-menu-title">{productName()}</DrawerTitle>
        <ul className="phone-menu-list" data-slot="phone-menu-list">
          {items.map((item) => (
            <li key={item.id} data-slot-item={item.id}>
              {/* why: closing first, the next dialog then takes focus from a settled page, not a sheet mid-exit. */}
              <DrawerClose className="phone-menu-row" onClick={() => requestAnimationFrame(item.onSelect)}>
                <span className="phone-menu-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="phone-menu-text">
                  <span className="phone-menu-label">{item.label}</span>
                  {item.hint ? <span className="phone-menu-hint">{item.hint}</span> : null}
                </span>
              </DrawerClose>
            </li>
          ))}
        </ul>
        <ThemeChoice />
        <DrawerFooter className="sheet-footer">
          <DrawerClose render={<Button variant="secondary" className="h-[44px] w-full text-[13px]" />}>{strings.done}</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

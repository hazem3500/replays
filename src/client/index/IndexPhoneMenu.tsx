import { MoonIcon, SettingsIcon, SunIcon, UploadIcon, UserRoundIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Drawer, DrawerClose, DrawerContent, DrawerFooter, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer.tsx';

import { accountMenuItems } from '../account/AccountMenu.tsx';
import { productName } from '../config.ts';
import type { Account } from '../queries.ts';
import { openSettings } from '../settings/Settings.tsx';
import { useThemeControls } from '../theme.tsx';

const strings = {
  trigger: 'Menu',
  upload: 'Upload a replay',
  uploadHint: '.json or .json.gz recording',
  settings: 'Settings',
  settingsHint: 'CLI setup, shortcuts, experiments',
  lightTheme: 'Light theme',
  darkTheme: 'Dark theme',
  done: 'Done',
};

export interface IndexPhoneMenuItem {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  onSelect: () => void;
  /** A link row instead of an action: Sign out leaves for the server, so the sheet needs no closing first. */
  href?: string;
}

/** The sheet's rows: the built-ins, then the signed-in account's (who, and Sign out where the auth mode has one). */
export function phoneMenuItems({ onUpload, account }: { onUpload?: () => void; account?: Account }): IndexPhoneMenuItem[] {
  return [
    ...(onUpload ? [{ id: 'upload', label: strings.upload, hint: strings.uploadHint, icon: <UploadIcon />, onSelect: onUpload }] : []),
    { id: 'settings', label: strings.settings, hint: strings.settingsHint, icon: <SettingsIcon />, onSelect: () => openSettings() },
    ...accountMenuItems(account).map((item) => ({
      id: item.testId ?? item.label,
      label: item.label,
      ...(item.detail ? { hint: item.detail } : {}),
      icon: item.icon,
      onSelect: item.onSelect,
      ...(item.href ? { href: item.href } : {}),
    })),
  ];
}

/** One row that flips the theme (like the desktop top bar's switch); the sheet stays open so the flip shows behind it. */
function ThemeRow() {
  const { theme, switchTheme } = useThemeControls();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <li data-slot-item="theme">
      <button type="button" className="phone-menu-row" data-testid="phone-menu-theme" onClick={switchTheme}>
        <span className="phone-menu-icon" aria-hidden="true">
          {next === 'light' ? <SunIcon /> : <MoonIcon />}
        </span>
        <span className="phone-menu-text">
          <span className="phone-menu-label">{next === 'light' ? strings.lightTheme : strings.darkTheme}</span>
        </span>
      </button>
    </li>
  );
}

function PhoneMenuRowContent({ item }: { item: IndexPhoneMenuItem }) {
  return (
    <>
      <span className="phone-menu-icon" aria-hidden="true">
        {item.icon}
      </span>
      <span className="phone-menu-text">
        <span className="phone-menu-label">{item.label}</span>
        {item.hint ? <span className="phone-menu-hint">{item.hint}</span> : null}
      </span>
    </>
  );
}

/**
 * Phones: the index header keeps two actions, search and this one. Upload, the theme and Settings fold into one
 * bottom sheet (thumb-reachable, 52 px rows) instead of four 40 px icons crowding the product name. Upload and
 * Settings open their own dialogs (still mounted by the header) after the sheet has closed.
 */
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
              {item.href ? (
                <a className="phone-menu-row" href={item.href} data-testid={item.id}>
                  <PhoneMenuRowContent item={item} />
                </a>
              ) : (
                // why: closing first, the next dialog then takes focus from a settled page, not a sheet mid-exit.
                <DrawerClose className="phone-menu-row" onClick={() => requestAnimationFrame(item.onSelect)}>
                  <PhoneMenuRowContent item={item} />
                </DrawerClose>
              )}
            </li>
          ))}
          <ThemeRow />
        </ul>
        <DrawerFooter className="sheet-footer">
          <DrawerClose render={<Button variant="secondary" className="h-[44px] w-full text-[13px]" />}>{strings.done}</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

import { type ReactNode, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

import { Dialog, DialogContent, DialogDescription } from '@/components/ui/dialog.tsx';

import { useMediaQuery } from '../media.ts';
import { viewerRegistry } from '../plugins/registry.ts';
import { settingsSections, type SettingsSectionId } from './sections.tsx';
import { SplitLayout, StackedList, StackedSection } from './SettingsLayouts.tsx';
import { strings } from './strings.ts';

import './settings.css';

export const SETTINGS_STACK_QUERY = '(max-width: 719px)';

/** Focus moves with the pushed screen either way; the ring only shows when a key moved it. */
function focusQuietly(element: HTMLElement | null | undefined, viaKeyboard: boolean) {
  element?.focus({ focusVisible: viaKeyboard } as FocusOptions);
}

/**
 * Settings: a fixed-size dialog with a section sidebar (so switching never resizes it), or on phones a full-screen sheet
 * whose section list pushes one section at a time. Controlled by its owner (SettingsButton / openSettings).
 */
export function SettingsDialog({
  open,
  onOpenChange,
  section,
  onSectionChange,
  showList = false,
  trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
  /** Phones: start on the section list instead of `section`. */
  showList?: boolean;
  /** The element that opens it (a DialogTrigger), rendered in place. */
  trigger?: ReactNode;
}) {
  const stacked = useMediaQuery(SETTINGS_STACK_QUERY);
  const [listShown, setListShown] = useState(showList);
  const [openedWith, setOpenedWith] = useState({ open, showList });
  if (openedWith.open !== open || (open && openedWith.showList !== showList)) {
    setOpenedWith({ open, showList });
    if (open) setListShown(showList);
  }
  const [instant, setInstant] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  // why: `when` on the Plugins descriptor reads the registry, which changes as plugins load.
  useSyncExternalStore(viewerRegistry.subscribe, viewerRegistry.getSnapshot);
  const sections = settingsSections({ stacked });
  const current = sections.find((candidate) => candidate.section === section) ?? sections[0]!;
  const pane: 'list' | 'section' = stacked && listShown ? 'list' : 'section';

  function select(next: SettingsSectionId, viaKeyboard: boolean) {
    setInstant(viaKeyboard);
    onSectionChange(next);
  }

  // why: a pushed screen unmounts the focused control, so focus must move to the new screen's anchor.
  function pushSection(next: SettingsSectionId, viaKeyboard: boolean) {
    select(next, false);
    flushSync(() => setListShown(false));
    focusQuietly(popup.current?.querySelector<HTMLElement>('.settings-back'), viaKeyboard);
  }

  function popToList(viaKeyboard: boolean) {
    flushSync(() => setListShown(true));
    focusQuietly(popup.current?.querySelector<HTMLElement>(`[data-slot-item="${current.id}"]`), viaKeyboard);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (!next && pane === 'section' && stacked && details.reason === 'escape-key') {
          details.cancel();
          popToList(true);
          return;
        }
        onOpenChange(next);
      }}
    >
      {trigger}
      <DialogContent
        ref={popup}
        showCloseButton={false}
        className="settings-dialog"
        data-layout={stacked ? 'stack' : 'split'}
        data-pane={pane}
        initialFocus={(openType) =>
          !stacked
            ? popup.current?.querySelector<HTMLElement>('.settings-tab[aria-selected="true"]')
            : // why: on touch a focused first control reads as a stray selection, so the sheet itself takes focus.
              openType === 'keyboard'
              ? popup.current?.querySelector<HTMLElement>(pane === 'list' ? '.settings-nav-row' : '.settings-back')
              : popup.current
        }
      >
        <DialogDescription className="sr-only">{strings.description}</DialogDescription>
        {!stacked ? (
          <SplitLayout sections={sections} current={current} instant={instant} onSelect={select} />
        ) : pane === 'list' ? (
          <StackedList sections={sections} onOpen={pushSection} />
        ) : (
          <StackedSection current={current} onBack={popToList} />
        )}
      </DialogContent>
    </Dialog>
  );
}

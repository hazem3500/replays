import { type ReactNode, type RefObject, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

import { Dialog, DialogContent, DialogDescription } from '@/components/ui/dialog.tsx';

import { useMediaQuery } from '../media.ts';
import { viewerRegistry } from '../plugins/registry.ts';
import { type SettingsSectionDescriptor, settingsSections, type SettingsSectionId } from './sections.tsx';
import { SplitLayout, StackedList, StackedSection } from './SettingsLayouts.tsx';
import { strings } from './strings.ts';

export const SETTINGS_STACK_QUERY = '(max-width: 719px)';

type Pane = 'list' | 'section';

/** Focus moves with the pushed screen either way; the ring only shows when a key moved it. */
function focusQuietly(element: HTMLElement | null | undefined, viaKeyboard: boolean) {
  element?.focus({ focusVisible: viaKeyboard });
}

/** Desktop focuses the selected tab; on touch a focused first control reads as a stray selection, so the sheet takes it. */
function initialFocusFor(popup: RefObject<HTMLDivElement | null>, stacked: boolean, pane: Pane) {
  return (openType: string) => {
    const root = popup.current;
    if (!stacked) return root?.querySelector<HTMLElement>('.settings-tab[aria-selected="true"]');
    if (openType !== 'keyboard') return root;
    return root?.querySelector<HTMLElement>(pane === 'list' ? '.settings-nav-row' : '.settings-back');
  };
}

function SettingsBody({
  stacked,
  pane,
  sections,
  current,
  instant,
  onSelect,
  onPush,
  onPop,
}: {
  stacked: boolean;
  pane: Pane;
  sections: readonly SettingsSectionDescriptor[];
  current: SettingsSectionDescriptor;
  instant: boolean;
  onSelect: (section: SettingsSectionId, viaKeyboard: boolean) => void;
  onPush: (section: SettingsSectionId, viaKeyboard: boolean) => void;
  onPop: (viaKeyboard: boolean) => void;
}) {
  if (!stacked) return <SplitLayout sections={sections} current={current} instant={instant} onSelect={onSelect} />;
  if (pane === 'list') return <StackedList sections={sections} onOpen={onPush} />;
  return <StackedSection current={current} onBack={onPop} />;
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
  /** Phones: start on the section list instead of `section`. */
  showList?: boolean;
  /** The element that opens it (a DialogTrigger), rendered in place. */
  trigger?: ReactNode;
}

/**
 * Settings: a fixed-size dialog with a section sidebar (so switching never resizes it), or on phones a full-screen sheet
 * whose section list pushes one section at a time. Controlled by its owner (SettingsButton / openSettings).
 */
export function SettingsDialog({ open, onOpenChange, section, onSectionChange, showList = false, trigger }: SettingsDialogProps) {
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
  const current = sections.find((candidate) => candidate.section === section) ?? sections[0];
  if (!current) return null;
  const pane: Pane = stacked && listShown ? 'list' : 'section';

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

  function popToList(id: string, viaKeyboard: boolean) {
    flushSync(() => setListShown(true));
    focusQuietly(popup.current?.querySelector<HTMLElement>(`[data-slot-item="${id}"]`), viaKeyboard);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (!next && pane === 'section' && stacked && details.reason === 'escape-key') {
          details.cancel();
          popToList(current.id, true);
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
        initialFocus={initialFocusFor(popup, stacked, pane)}
      >
        <DialogDescription className="sr-only">{strings.description}</DialogDescription>
        <SettingsBody
          stacked={stacked}
          pane={pane}
          sections={sections}
          current={current}
          instant={instant}
          onSelect={select}
          onPush={pushSection}
          onPop={(viaKeyboard) => popToList(current.id, viaKeyboard)}
        />
      </DialogContent>
    </Dialog>
  );
}

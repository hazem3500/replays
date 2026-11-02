import { type ReactNode, type RefObject, useRef } from 'react';

import { Drawer, DrawerContent } from '@/components/ui/drawer.tsx';

/**
 * The phone editor's settings sheet: a bottom sheet over the timeline (as tall as its settings, at most the part of
 * the screen under the picture, scrolling beyond that; drag it down to close) holding the selected object's settings,
 * the trim or the cursor options. Non-modal, so the picture stays in view, plays and takes a blur's placement while it
 * is open; Escape closes it.
 */
export function PhoneSheet({
  open,
  label,
  container,
  onClose,
  children,
}: {
  open: boolean;
  label: string;
  /** The editor shell: the sheet mounts inside it, so the phone editor's styles apply to its settings. */
  container: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      modal={false}
      disablePointerDismissal
    >
      <DrawerContent
        ref={popup}
        scrim={false}
        container={container}
        className="phone-sheet"
        aria-label={label}
        // why: a caption's text is what one opens it for; anything else starts at its heading.
        initialFocus={() =>
          popup.current?.querySelector<HTMLElement>('#selection-caption-text') ??
          popup.current?.querySelector<HTMLElement>('.editor-context-panel h2') ??
          true
        }
        data-testid="phone-sheet"
      >
        {children}
      </DrawerContent>
    </Drawer>
  );
}

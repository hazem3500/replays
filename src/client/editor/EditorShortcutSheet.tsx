import { XIcon } from 'lucide-react';
import { useRef } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog.tsx';
import { Kbd, KbdGroup } from '@/components/ui/kbd.tsx';

import { EDITOR_SHORTCUT_GROUPS } from './editor-tools.ts';

/**
 * The editor's keys in the viewer sheet's look. why: importing the viewer's sheet moves it into the chunk the
 * viewer and editor share and renames that chunk, which drops its bundle budget.
 */
export function EditorShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const close = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        initialFocus={close}
        className="shortcut-sheet gap-0 p-0 sm:max-w-xl"
        data-testid="shortcut-sheet"
      >
        <div className="sheet-header">
          <DialogTitle className="text-[length:var(--text-md)] font-semibold">Keyboard shortcuts</DialogTitle>
          <DialogClose
            render={
              <Button
                ref={close}
                variant="ghost"
                size="icon"
                aria-label="Close keyboard shortcuts"
                className="text-[var(--text-secondary)]"
              />
            }
          >
            <XIcon aria-hidden="true" />
          </DialogClose>
        </div>
        <div className="sheet-body">
          {EDITOR_SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.items.map((item) => (
                  <div key={item.label}>
                    <dt>{item.label}</dt>
                    <dd>
                      <KbdGroup>
                        {item.keys.map((key) => (
                          <Kbd key={key} className="font-mono">
                            {key}
                          </Kbd>
                        ))}
                      </KbdGroup>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <DialogDescription className="sheet-note">Shortcuts pause while you type in a field.</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

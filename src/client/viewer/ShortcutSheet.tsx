import { XIcon } from 'lucide-react';
import { useRef } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog.tsx';
import { Kbd, KbdGroup } from '@/components/ui/kbd.tsx';

import { commentsEnabled } from '../comments/enabled.ts';
import { SHORTCUT_GROUPS } from '../shortcuts.ts';

/** Modal sheet (Base UI Dialog): the keyboard stays inside, Esc closes, and the opener gets the keyboard back. */
export function ShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const close = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        initialFocus={close}
        className="shortcut-sheet gap-0 p-0 sm:max-w-3xl"
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
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.items
                  .filter((item) => item.feature !== 'comments' || commentsEnabled())
                  .map((item) => (
                    <div key={item.label}>
                      <dt>{item.label}</dt>
                      <dd>
                        <KbdGroup>
                          {item.keys.map((key) => (
                            <Kbd
                              key={key}
                              className="h-[22px] min-w-[22px] px-1.5 font-mono text-(length:--text-2xs) text-[var(--text-secondary)]"
                            >
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

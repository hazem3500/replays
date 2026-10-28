import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { useDialogFocus } from '../../hooks/dialog-focus.ts';
/** Copy-owned dialog shell, with the recorder kit handling focus and inert siblings. */
export function Dialog({ title, children, onCancel }: { title: string; children: ReactNode; onCancel: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useDialogFocus(root, onCancel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-lg"
      >
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

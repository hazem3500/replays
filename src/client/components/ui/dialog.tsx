import * as React from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cn } from '@/lib/utils.ts';

import { Button } from '@/components/ui/button.tsx';
import { XIcon } from 'lucide-react';

/**
 * Geometry comes from the --dialog-* tokens (styles.css). The popup picks its padding and close size into local
 * variables (--dialog-pad, --dialog-close) so phones and touch get the compact padding and a 40 px close without
 * extra media rules, and a consumer's `p-0` still replaces the whole padding through tailwind-merge.
 */
const dialogPopupClassName =
  'motion-modal fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-(--dialog-gap) overflow-y-auto overscroll-contain rounded-xl bg-popover p-(--dialog-pad) text-xs/relaxed text-popover-foreground shadow-(--shadow-pop) ring-1 ring-foreground/10 outline-none [--dialog-close:var(--dialog-close-size)] [--dialog-pad:var(--dialog-padding)] max-sm:[--dialog-pad:var(--dialog-padding-compact)] pointer-coarse:[--dialog-close:var(--dialog-close-size-touch)] max-h-[calc(100dvh_-_2rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] sm:max-w-sm';

/** The close glyph's right edge lines up with the content edge, and its box centres on the title's first line. */
const dialogCloseClassName =
  'absolute top-[calc(var(--dialog-pad)_+_(var(--dialog-title-line)_-_var(--dialog-close))_/_2)] right-[calc(var(--dialog-pad)_-_(var(--dialog-close)_-_1rem)_/_2)] size-(--dialog-close) text-[var(--text-secondary)] hover:text-foreground';

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn('motion-backdrop fixed inset-0 isolate z-50 bg-(--scrim)', className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          dialogPopupClassName,
          // why: a wrapping title would otherwise run under the close button.
          showCloseButton && '[&_[data-slot=dialog-title]]:pe-[calc(var(--dialog-close)_+_4px)]',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={<Button variant="ghost" size="icon-sm" className={dialogCloseClassName} />}
          >
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-1', className)} {...props} />;
}

/**
 * Actions in reading order: [Cancel] [Primary]. Desktop (wide, not touch): one right-aligned row, 8 px apart,
 * 32 px tall. Phones and touch: stacked full width, 44 px tall, the primary on top (column-reverse), so the DOM and
 * focus order stay Cancel first.
 */
function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'flex flex-col-reverse gap-2 *:h-(--dialog-action-height-touch) *:w-full *:px-3 *:text-(length:--dialog-body-size) sm:not-pointer-coarse:flex-row sm:not-pointer-coarse:justify-end sm:not-pointer-coarse:*:h-(--dialog-action-height) sm:not-pointer-coarse:*:w-auto',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('m-0 text-(length:--text-md) leading-(--dialog-title-line) font-semibold wrap-break-word text-foreground', className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'm-0 text-(length:--dialog-body-size) leading-(--dialog-body-line) text-pretty text-[var(--text-secondary)] *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};

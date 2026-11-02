import * as React from 'react';
import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';
import type { VariantProps } from 'class-variance-authority';

import { Button, type buttonVariants } from '@/components/ui/button.tsx';
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx';

/**
 * Confirmations (role="alertdialog"): Base UI's AlertDialog shares the Dialog parts (popup, title, description,
 * close) and only changes the root, which ignores outside clicks. So the layout, spacing and motion are exactly
 * the Dialog's; what differs is no close button by default (Cancel is the way out, Esc still works) and the
 * Cancel/Action pair. Focus lands on Cancel, the first action, so Enter never confirms a destructive action blind.
 */
function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

function AlertDialogContent({ showCloseButton = false, ...props }: React.ComponentProps<typeof DialogContent>) {
  return <DialogContent showCloseButton={showCloseButton} {...props} />;
}

const AlertDialogHeader = DialogHeader;
const AlertDialogFooter = DialogFooter;
const AlertDialogTitle = DialogTitle;
const AlertDialogDescription = DialogDescription;

function AlertDialogCancel({ children = 'Cancel', ...props }: AlertDialogPrimitive.Close.Props) {
  return (
    <AlertDialogPrimitive.Close data-slot="alert-dialog-cancel" render={<Button variant="secondary" />} {...props}>
      {children}
    </AlertDialogPrimitive.Close>
  );
}

/** The confirming action; closes the dialog after its onClick. Keep the dialog open (pending work) by controlling `open`. */
function AlertDialogAction({
  variant = 'default',
  ...props
}: AlertDialogPrimitive.Close.Props & Pick<VariantProps<typeof buttonVariants>, 'variant'>) {
  return <AlertDialogPrimitive.Close data-slot="alert-dialog-action" render={<Button variant={variant} />} {...props} />;
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
};

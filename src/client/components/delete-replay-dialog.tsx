import type * as React from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog.tsx';

/**
 * The delete confirmation says what happens: who loses it and whether it comes back. `restoreDays` is set once
 * deletes go to a Trash (soft delete); without it the delete is permanent.
 */
export function deleteReplayCopy(title: string, restoreDays?: number) {
  return {
    title: `Delete “${title}”?`,
    body: restoreDays
      ? `It’s removed for everyone. You can restore it from Trash for ${restoreDays} days.`
      : 'It’s removed for everyone. This can’t be undone.',
  };
}

export function DeleteReplayDialog({
  title,
  restoreDays,
  trigger,
  open,
  onOpenChange,
  onDelete,
}: {
  title: string;
  restoreDays?: number;
  /** An element rendered as the trigger (Base UI `render`), e.g. `<Button variant="ghost" />`, with its label as children. */
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onDelete: () => void;
}) {
  const copy = deleteReplayCopy(title, restoreDays);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger && <AlertDialogTrigger render={trigger} />}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel />
          <AlertDialogAction variant="destructive" onClick={onDelete}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

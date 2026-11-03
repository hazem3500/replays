import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx';
import { dataStorageQuery } from '../queries.ts';

function RestoreWindow() {
  const policy = useQuery(dataStorageQuery);
  const days = policy.data?.retention.trashDays;
  if (days === undefined || days <= 0) return <span>Trashed recordings are managed in Settings.</span>;
  return (
    <span>
      You can restore it from Settings for {days} {days === 1 ? 'day' : 'days'}.
    </span>
  );
}

/** Names the individual recording before invoking the server's existing trash and keep policy. */
export function ReplayDeleteDialog({
  title,
  open,
  pending,
  error,
  close,
  submit,
}: {
  title: string;
  open: boolean;
  pending: boolean;
  error: string | undefined;
  close: () => void;
  submit: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) close();
      }}
    >
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Delete replay?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground wrap-anywhere">{title}</span> moves to trash. <RestoreWindow />
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={submit}>
            {pending ? 'Moving to trash…' : 'Move to trash'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

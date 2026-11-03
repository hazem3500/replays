import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Trash2Icon } from 'lucide-react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx';
import type { DataStorageInfo } from '../../shared/data-storage.ts';
import { INDEX_SESSIONS_KEY } from '../index/index-queries.ts';
import { changeReplayStorage, dataStorageQuery, deleteAllReplays } from '../queries.ts';
import { SettingsGroup, SettingsRow } from './rows.tsx';
import { strings } from './strings.ts';

const copy = strings.dataStorage;
const storageLabels: Record<string, string> = { fs: 'Local files', s3: 'S3', memory: 'Memory' };
const windowLabel = (days: number) => (days > 0 ? copy.days(days) : copy.forever);
const dateLabel = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function Policy({ data }: { data: DataStorageInfo }) {
  return (
    <SettingsGroup title={copy.policy} footer={copy.policyHint}>
      <SettingsRow label={copy.backend} control={<span className="settings-value">{storageLabels[data.backend] ?? data.backend}</span>} />
      <SettingsRow label={copy.defaultRetention} control={<span className="settings-value">{windowLabel(data.retention.days)}</span>} />
      {Object.entries(data.retention.profiles).map(([id, days]) => (
        <SettingsRow key={id} label={id} control={<span className="settings-value">{windowLabel(days)}</span>} />
      ))}
      {data.retention.hasRules ? <SettingsRow label={copy.rules} control={<span className="settings-value">{copy.rulesOn}</span>} /> : null}
      <SettingsRow label={copy.trashWindow} control={<span className="settings-value">{copy.days(data.retention.trashDays)}</span>} />
    </SettingsGroup>
  );
}

function TrashList({
  entries,
  pending,
  days,
  restore,
  refresh,
}: {
  entries: DataStorageInfo['trash'];
  pending: boolean;
  days: number;
  restore: (id: string) => void;
  refresh: () => Promise<unknown>;
}) {
  return (
    <section className="storage-trash" aria-labelledby="storage-trash-title">
      <div className="storage-section-head">
        <h3 id="storage-trash-title">
          {copy.trash}
          <span className="storage-count">{entries.length}</span>
        </h3>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            void refresh();
          }}
        >
          <AnimatedIcon name="rotate-ccw" />
          {copy.refresh}
        </Button>
      </div>
      {entries.length === 0 ? (
        <div className="storage-empty">
          <Trash2Icon aria-hidden="true" />
          <span>{copy.empty}</span>
        </div>
      ) : (
        <div className="storage-trash-list">
          {entries.map((entry) => (
            <SettingsRow
              key={entry.id}
              label={<span className="storage-replay-name">{entry.id}</span>}
              description={`${copy.deleted} ${dateLabel(entry.deletedAt)} · ${copy.until.toLowerCase()} ${dateLabel(entry.restorableUntil)}`}
              control={
                <Button variant="outline" size="sm" disabled={pending} onClick={() => restore(entry.id)}>
                  {copy.restore}
                </Button>
              }
            />
          ))}
        </div>
      )}
      <p className="settings-group-footer">{copy.cleanup(days)}</p>
    </section>
  );
}

function DeleteConfirmation({
  open,
  pending,
  days,
  error,
  onOpenChange,
  onDelete,
}: {
  open: boolean;
  pending: boolean;
  days: number;
  error: string | undefined;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.confirmTitle}</DialogTitle>
          <DialogDescription>{copy.confirm(days)}</DialogDescription>
        </DialogHeader>
        {error ? <p role="alert">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            {copy.cancel}
          </Button>
          <Button variant="destructive" disabled={pending} onClick={onDelete}>
            {pending ? copy.deleting : copy.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StorageActions({ data, refresh }: { data: DataStorageInfo; refresh: () => Promise<unknown> }) {
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const update = async () => {
    await Promise.all([
      refresh(),
      client.invalidateQueries({ queryKey: INDEX_SESSIONS_KEY }),
      client.invalidateQueries({ queryKey: ['replay'] }),
    ]);
  };
  const restore = useMutation({
    mutationFn: (id: string) => changeReplayStorage(id, 'restore'),
    onSuccess: async () => {
      setMessage(copy.restored);
      await update();
    },
  });
  const remove = useMutation({
    mutationFn: deleteAllReplays,
    onSuccess: async (result) => {
      setConfirm(false);
      setMessage(copy.result(result.trashed, result.protected, result.failed + result.unavailable));
      await update();
    },
  });
  const pending = restore.isPending || remove.isPending;
  return (
    <>
      <TrashList
        entries={data.trash}
        days={data.retention.trashDays}
        pending={pending}
        refresh={refresh}
        restore={(id) => {
          setMessage('');
          restore.mutate(id);
        }}
      />
      <div className="storage-delete-section">
        <SettingsRow
          label={copy.manage}
          description={data.replayCount === 0 ? copy.emptyUploads : copy.manageHint}
          control={
            <Button
              variant="destructive"
              size="sm"
              disabled={pending || data.replayCount === 0}
              onClick={() => {
                remove.reset();
                setMessage('');
                setConfirm(true);
              }}
            >
              {copy.delete}
            </Button>
          }
        />
      </div>
      {message ? (
        <p className="storage-feedback" role="status">
          {message}
        </p>
      ) : null}
      {restore.isError ? (
        <p className="storage-feedback" role="alert">
          {restore.error.message}
        </p>
      ) : null}
      <DeleteConfirmation
        open={confirm}
        pending={pending}
        days={data.retention.trashDays}
        error={remove.isError ? remove.error.message : undefined}
        onOpenChange={setConfirm}
        onDelete={() => remove.mutate()}
      />
    </>
  );
}

/** Storage actions retain server authorization and the same restore window as individual deletion. */
export function DataStorage() {
  const query = useQuery(dataStorageQuery);
  if (query.isPending)
    return (
      <p className="settings-intro" role="status">
        {copy.loading}
      </p>
    );
  if (query.isError)
    return (
      <div role="alert" className="settings-intro">
        <p>{copy.failed}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void query.refetch();
          }}
        >
          {copy.retry}
        </Button>
      </div>
    );
  return (
    <div className="storage-settings">
      <Policy data={query.data} />
      <StorageActions data={query.data} refresh={() => query.refetch()} />
    </div>
  );
}

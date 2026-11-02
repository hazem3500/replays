import { CheckIcon } from 'lucide-react';

import { Hint } from '@/components/icon-button.tsx';
import { Button } from '@/components/ui/button.tsx';

import type { StoredReplayEdits } from '../../shared/edits.ts';
import type { LoadedEdits } from '../edits.ts';
import type { SaveStatus } from '../hooks/use-editor-session.ts';
import { savedAgo } from './state.ts';
import { editorStrings } from './strings.ts';

const strings = editorStrings.save;

/**
 * A quiet word beside the title: Saving… / Saved (who and when in its tooltip). A failed save is a detail here,
 * "Not saved · Retry" (it also retries on its own), and a server without the edits API says so once, in grey.
 */
export function SaveIndicator({
  status,
  dirty,
  stored,
  failure,
  onRetry,
}: {
  status: SaveStatus;
  dirty: boolean;
  stored: StoredReplayEdits;
  failure: string;
  onRetry: () => void;
}) {
  if (dirty && status === 'unavailable') {
    return (
      <span className="editor-save-state" data-state="unavailable" data-testid="save-state" role="status">
        {strings.unavailable}
      </span>
    );
  }
  if (dirty && status === 'failed') {
    return (
      <span className="editor-save-state" data-state="failed" data-testid="save-state" role="status">
        <Hint label={failure || strings.failed} side="bottom" align="start">
          <span tabIndex={-1}>{strings.notSaved}</span>
        </Hint>
        <span aria-hidden="true">·</span>
        <button type="button" className="editor-retry" onClick={onRetry} data-testid="save-retry">
          {strings.retry}
        </button>
      </span>
    );
  }
  const text = status === 'saving' || dirty ? strings.saving : stored.revision > 0 ? strings.saved : strings.notEdited;
  const saved = text === strings.saved;
  const detail =
    stored.revision > 0 && stored.updatedBy ? strings.lastSaved(stored.updatedBy, savedAgo(stored.updatedAt)) : strings.savesAsYouEdit;
  return (
    <Hint label={detail} side="bottom" align="start">
      <span className="editor-save-state" data-state={saved ? 'saved' : status} data-testid="save-state" role="status" tabIndex={-1}>
        {saved ? <CheckIcon aria-hidden="true" /> : null}
        {text}
      </span>
    </Hint>
  );
}

/** Someone saved newer edits: load theirs or keep mine (the next save overwrites theirs). */
export function ConflictNotice({ conflict, onLoadTheirs, onKeepMine }: { conflict: LoadedEdits; onLoadTheirs: () => void; onKeepMine: () => void }) {
  return (
    <div className="editor-conflict" role="status">
      {strings.conflict(conflict.stored.updatedBy ?? strings.someone, savedAgo(conflict.stored.updatedAt))}
      <Button size="sm" variant="ghost" onClick={onLoadTheirs}>
        {strings.loadTheirs}
      </Button>
      <Button size="sm" variant="ghost" onClick={onKeepMine}>
        {strings.keepMine}
      </Button>
    </div>
  );
}

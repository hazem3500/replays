import { DownloadIcon } from 'lucide-react';

import { Hint } from '@/components/icon-button.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Popover, PopoverContent } from '@/components/ui/popover.tsx';
import { Progress } from '@/components/ui/progress.tsx';
import { useRef } from 'react';

import { editListOf, editsVersion, type StoredReplayEdits } from '../../shared/edits.ts';
import type { ReplayMeta } from '../../shared/replay.ts';
import { apiUrl } from '../api/fetch.ts';
import { notify } from '../toast.ts';
import { isActive, progressAnnouncement, progressLabel, useVideoRender } from '../video-export.ts';

/** Exports the saved edit list, never a stale revision or the editor preview's temporary playback speed. */
export function EditorExport({
  meta,
  stored,
  dirty,
  saving,
}: {
  meta: ReplayMeta;
  stored: StoredReplayEdits;
  dirty: boolean;
  saving: boolean;
}) {
  const render = useVideoRender(apiUrl(`replays/${encodeURIComponent(meta.id)}/render`), meta.id, notify, {
    speed: 1,
    skipInactive: false,
    captions: false,
    edits: editsVersion(editListOf(stored)),
  });
  const anchor = useRef<HTMLSpanElement>(null);
  const active = isActive(render.state);
  const waiting = dirty || saving;
  const label = waiting
    ? 'Changes are saving before export'
    : render.availability === 'unavailable'
      ? 'Video export is turned off on this server'
      : render.availability === 'unknown'
        ? 'Checking video export availability'
        : 'Export the edited replay as MP4';
  return (
    <Popover open={render.state.kind !== 'idle'} onOpenChange={(open) => !open && render.state.kind === 'error' && render.dismiss()}>
      <span ref={anchor} className="inline-flex">
        <Hint label={label} side="bottom" align="end">
          <span className="inline-flex">
            <Button
              size="sm"
              className="editor-export"
              disabled={waiting || active || render.availability !== 'available'}
              onClick={() => void render.start()}
              data-testid="editor-export"
            >
              <DownloadIcon aria-hidden="true" /> {active ? 'Exporting…' : 'Export'}
            </Button>
          </span>
        </Hint>
        <span className="sr-only" role="status">
          {progressAnnouncement(render.state)}
        </span>
      </span>
      <PopoverContent
        anchor={anchor}
        align="end"
        initialFocus={false}
        finalFocus={false}
        className="w-64 max-w-[calc(100vw-16px)] gap-2"
        data-testid="editor-export-status"
      >
        <div className="flex items-center justify-between gap-2">
          <span>{progressLabel(render.state)}</span>
          {render.state.kind === 'error' ? (
            <Button size="xs" variant="ghost" onClick={render.dismiss}>
              Dismiss
            </Button>
          ) : (
            <Button size="xs" variant="ghost" onClick={render.cancel}>
              Cancel
            </Button>
          )}
        </div>
        {active ? (
          <Progress
            value={render.state.kind === 'rendering' ? Math.round(render.state.progress * 100) : null}
            aria-label="Export progress"
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

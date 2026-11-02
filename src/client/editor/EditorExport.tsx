import { ChevronDownIcon, DownloadIcon, FilmIcon } from 'lucide-react';
import { type ReactNode, useRef } from 'react';

import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Popover, PopoverContent } from '@/components/ui/popover.tsx';
import { Progress } from '@/components/ui/progress.tsx';

import { editListOf, editsVersion, type StoredReplayEdits } from '../../shared/edits.ts';
import type { ReplayMeta } from '../../shared/replay.ts';
import type { SlotDescriptor } from '../plugins/slots.ts';
import { apiUrl } from '../route.ts';
import { notify } from '../toast.ts';
import { isActive, progressAnnouncement, progressLabel, useVideoRender } from '../video-export.ts';
import { editorStrings } from './strings.ts';

const strings = editorStrings.export;

/** What an export format's menu item knows: whether the saved edits can be exported now, and why not. */
export interface ExportFormatContext {
  /** Why nothing can start right now (saving, unavailable, already running), else undefined. */
  blocked: string | undefined;
  startVideo: () => void;
}

/** `export.formats`: the Export menu's items, MP4 first. Built-ins are `core:*`. */
export const EXPORT_FORMATS: readonly SlotDescriptor<ExportFormatContext, ReactNode>[] = [
  {
    id: 'core:mp4',
    order: 100,
    render: ({ blocked, startVideo }) => (
      <DropdownMenuItem key="core:mp4" disabled={Boolean(blocked)} onClick={startVideo} data-testid="export-mp4" className="editor-export-format">
        <FilmIcon aria-hidden="true" />
        <span className="editor-export-format-text">
          <span>{strings.mp4}</span>
          <small>{blocked ?? strings.mp4Detail}</small>
        </span>
      </DropdownMenuItem>
    ),
  },
];

/**
 * The editor's primary action. It always opens (never reads disabled): each format says itself why it can't start.
 * Exports the saved edit list, never a stale revision or the preview's temporary playback speed.
 */
export function EditorExport({ meta, stored, dirty, saving }: { meta: ReplayMeta; stored: StoredReplayEdits; dirty: boolean; saving: boolean }) {
  const render = useVideoRender(apiUrl(`replays/${encodeURIComponent(meta.id)}/render`), meta.id, notify, {
    speed: 1,
    skipInactive: false,
    captions: false,
    edits: editsVersion(editListOf(stored)),
  });
  const anchor = useRef<HTMLSpanElement>(null);
  const active = isActive(render.state);
  const blocked =
    dirty || saving
      ? strings.saving
      : active
        ? strings.busy
        : render.availability === 'unavailable'
          ? strings.unavailable
          : render.availability === 'unknown'
            ? strings.checking
            : undefined;
  const context: ExportFormatContext = { blocked, startVideo: () => void render.start() };
  const formats = [...EXPORT_FORMATS].sort((a, b) => a.order - b.order).filter((format) => !format.when || format.when(context));
  return (
    <Popover open={render.state.kind !== 'idle'} onOpenChange={(open) => !open && render.state.kind === 'error' && render.dismiss()}>
      <span ref={anchor} className="inline-flex">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button className="editor-export" data-testid="editor-export" data-active={active || undefined} />}>
            <DownloadIcon aria-hidden="true" />
            {active ? strings.exporting : strings.button}
            <ChevronDownIcon aria-hidden="true" className="editor-export-chevron" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" className="w-auto min-w-60" data-slot="export.formats">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{strings.menu}</DropdownMenuLabel>
              {formats.map((format) => format.render(context))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
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
              {strings.dismiss}
            </Button>
          ) : (
            <Button size="xs" variant="ghost" onClick={render.cancel}>
              {strings.cancel}
            </Button>
          )}
        </div>
        {active ? (
          <Progress value={render.state.kind === 'rendering' ? Math.round(render.state.progress * 100) : null} aria-label={strings.progress} />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

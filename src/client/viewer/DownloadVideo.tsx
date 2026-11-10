import { MotionLabel } from '../components/entry-motion.tsx';
import { type PluginExportOption, usePluginExports } from '../hooks/use-plugin-exports.ts';
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { FileVideoCameraIcon } from 'lucide-react';
import { AnimatedIcon } from '@/components/animated-icon.tsx';

import { Hint, IconButton } from '@/components/icon-button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Popover, PopoverContent } from '@/components/ui/popover.tsx';
import { Progress } from '@/components/ui/progress.tsx';

import type { ReplayMeta } from '../../shared/replay.ts';
import { apiUrl } from '../api/fetch.ts';
import { usePlayerState } from '../player.ts';
import {
  downloadUrl,
  exportLabel,
  formatBytes,
  isActive,
  progressAnnouncement,
  progressLabel,
  useVideoRender,
  videoFilename,
} from '../video-export.ts';
import { useViewer } from './context.ts';
import type { TopbarMenuItem } from '../Topbar.tsx';

/** A stored MP4 the server confirmed; `undefined` while unknown or absent. */
function useStoredVideo(meta: ReplayMeta) {
  const [stored, setStored] = useState<{ id: string; href: string; size?: number }>();
  useEffect(() => {
    // `meta.videoFile` says the capture recorded one; the upload is a second request that can fail, so confirm it.
    if (!meta.videoFile) return;
    const href = apiUrl(`replays/${encodeURIComponent(meta.id)}/video`);
    const controller = new AbortController();
    const isVideo = (response: Response) => response.ok && Boolean(response.headers.get('content-type')?.startsWith('video/'));
    const probe = async () => {
      let response = await fetch(href, { method: 'HEAD', signal: controller.signal });
      // Servers older than HEAD support fall through to the SPA for HEAD: read GET headers, then drop the body.
      if (!isVideo(response)) {
        const probeGet = new AbortController();
        controller.signal.addEventListener('abort', () => probeGet.abort());
        response = await fetch(href, { signal: probeGet.signal });
        probeGet.abort();
      }
      if (!isVideo(response)) return;
      const size = Number(response.headers.get('content-length'));
      setStored(Number.isFinite(size) && size > 0 ? { id: meta.id, href, size } : { id: meta.id, href });
    };
    probe().catch(() => undefined);
    return () => controller.abort();
  }, [meta.id, meta.videoFile]);
  return stored?.id === meta.id ? stored : undefined;
}

/** The render job and stored-MP4 state behind both download forms (the icon button and the phone's "More" items). */
function useVideoDownload(meta: ReplayMeta) {
  const { notify, captions: captionsOn, steps, editsVersion, editCaptions } = useViewer();
  const { speed, skipInactive } = usePlayerState();
  // The export follows the player: its speed, skip inactive, and step captions (when there are steps to caption); it
  // always applies the replay's saved edits (also while the original is on screen).
  const variant = {
    speed,
    skipInactive,
    captions: captionsOn && steps.length > 0 && !editCaptions,
    ...(editsVersion ? { edits: editsVersion } : {}),
  };
  const stored = useStoredVideo(meta);
  const render = useVideoRender(apiUrl(`replays/${encodeURIComponent(meta.id)}/render`), meta.id, notify, variant);
  return { ...render, stored, variant, active: isActive(render.state), canRender: render.availability === 'available' };
}

type VideoDownload = ReturnType<typeof useVideoDownload>;

const BUNDLE_HINT = 'Shift and click saves the replay as JSON';

const keepShiftFromMenu = (event: { shiftKey: boolean; preventBaseUIHandler: () => void }) => {
  if (event.shiftKey) event.preventBaseUIHandler();
};

/**
 * Shift with a click saves the replay bundle as `<replay-id>.json` instead of the video. A keyboard press on the focused
 * button arrives as a click that keeps Shift, so Shift+Enter and Shift+Space work the same way.
 */
function useBundleDownload(meta: ReplayMeta) {
  const { notify } = useViewer();
  return () => {
    const filename = `${meta.id}.json`;
    downloadUrl(apiUrl(`replays/${encodeURIComponent(meta.id)}`), filename);
    notify(`Saved ${filename}`);
  };
}

/**
 * Render progress in a small popover anchored under `children` ("Rendering video… 40% · Cancel"), plus an
 * always-mounted status line so the first phase is announced too (the popover itself is not a live region).
 */
function DownloadProgress({ download, children }: { download: VideoDownload; children?: ReactNode }) {
  const { state, start, cancel, dismiss } = download;
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    // The popover is controlled by the render state only: clicks on the trigger area or outside never switch it.
    // It is anchored, not triggered: a Popover.Trigger wrapper would be a second tabbable "button" around the real one.
    <Popover open={state.kind !== 'idle'} onOpenChange={(open) => !open && state.kind === 'error' && dismiss()}>
      <span ref={anchor} className="inline-flex">
        {children}
        <span className="visually-hidden" role="status">
          {progressAnnouncement(state)}
        </span>
      </span>
      <PopoverContent
        anchor={anchor}
        align="end"
        initialFocus={false}
        finalFocus={false}
        className="w-64 max-w-[calc(100vw-16px)] gap-2"
        data-testid="video-export-status"
      >
        <div className="flex items-center justify-between gap-2">
          <MotionLabel key={state.kind} className={`text-swap ${state.kind === 'error' ? 'text-destructive' : 'tabular-nums'}`}>
            {progressLabel(state)}
          </MotionLabel>
          {state.kind === 'error' ? (
            <span className="flex shrink-0 gap-1">
              <Button variant="ghost" size="xs" onClick={() => void start()}>
                Retry
              </Button>
              <Button variant="ghost" size="xs" onClick={dismiss}>
                Dismiss
              </Button>
            </span>
          ) : (
            <Button variant="ghost" size="xs" onClick={cancel}>
              Cancel
            </Button>
          )}
        </div>
        {state.kind === 'error' ? null : (
          <Progress value={state.kind === 'rendering' ? Math.round(state.progress * 100) : null} aria-label="Render progress" />
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The last render availability any replay resolved to, so a run switch that remounts the viewer keeps its action. */
let lastResolvedAvailability = false;

/** Whether the render probe is still out, and the availability to assume meanwhile: this replay's last, else the last seen. */
function useSteadyAvailability({ availability, canRender }: { availability: string; canRender: boolean }) {
  const pending = availability === 'unknown';
  const [lastAvailable, setLastAvailable] = useState(() => canRender || lastResolvedAvailability);
  if (!pending && lastAvailable !== canRender) setLastAvailable(canRender);
  useEffect(() => {
    if (!pending) lastResolvedAvailability = canRender;
  }, [pending, canRender]);
  return { pending, lastAvailable };
}

/**
 * Downloads live in the topbar's "More" menu. Returns
 * the menu items and the progress anchor, which sits at the end of the bar's actions, under "More".
 */
export function useDownloadMenu(meta: ReplayMeta): { items: TopbarMenuItem[]; progress: ReactNode } {
  const formats = usePluginExports();
  const download = useVideoDownload(meta);
  const { stored, canRender, active, variant, start } = download;
  const items: TopbarMenuItem[] = [];
  const { pending, lastAvailable } = useSteadyAvailability(download);
  if (canRender || (pending && lastAvailable)) {
    items.push({
      label: active ? 'Rendering video…' : exportLabel(stored ? 'Export video' : 'Download video', variant),
      icon: <AnimatedIcon name="download" />,
      onSelect: () => void start(),
      disabled: active || pending,
      testId: stored ? 'export-video' : 'download-video',
    });
  }
  if (stored) {
    items.push({
      label: 'Download original MP4',
      icon: <FileVideoCameraIcon aria-hidden="true" />,
      onSelect: () => undefined,
      href: stored.href,
      download: videoFilename(meta.id),
      ...(stored.size ? { detail: formatBytes(stored.size) } : {}),
      testId: 'download-mp4',
    });
  }
  const allItems = formats.flatMap<TopbarMenuItem>((format) =>
    format === 'core' ? items : [{ label: format.label, icon: <AnimatedIcon name="download" />, onSelect: format.run, testId: format.key }],
  );
  return { items: allItems, progress: stored || canRender ? <DownloadProgress download={download} /> : null };
}

/**
 * One download icon for the Topbar's actions slot. Without a stored MP4 a
 * click starts a server render straight away; with one it opens a two-item
 * menu (Export video, Download original MP4). Render progress shows in a small
 * popover anchored under the button ("Rendering video… 40% · Cancel") and the
 * file downloads when the job is done. Hidden when the server cannot render
 * and there is no stored MP4.
 *
 * Every hook runs on every render and the early return comes after them, so
 * the availability probe resolving never changes the hook order.
 */
export function DownloadVideoButton({ meta }: { meta: ReplayMeta }) {
  const formats = usePluginExports();
  const download = useVideoDownload(meta);
  const { stored, canRender, active, variant, start } = download;
  const saveBundle = useBundleDownload(meta);

  const hasPlugins = formats.some((format) => format !== 'core');
  const showCore = formats.includes('core');
  const { pending, lastAvailable } = useSteadyAvailability(download);
  if (((!stored && !canRender && !(pending && lastAvailable)) || !showCore) && !hasPlugins) return null;

  const exportText = exportLabel('Export video', variant);
  const idleLabel = !stored && !canRender ? 'Download replay' : exportLabel('Download video', variant);
  const label = active ? 'Rendering video…' : idleLabel;
  const hint = (
    <>
      {label}
      <span className="block opacity-70">{BUNDLE_HINT}</span>
    </>
  );
  const trigger =
    stored || hasPlugins ? (
      <DropdownMenu>
        <Hint label={hint} side="bottom" align="end">
          <DropdownMenuTrigger
            disabled={active}
            // why: the menu opens on press, ahead of the click, so a Shift press must not reach it.
            onPointerDown={keepShiftFromMenu}
            onMouseDown={keepShiftFromMenu}
            onKeyDown={keepShiftFromMenu}
            onClick={(event) => {
              if (!event.shiftKey) return;
              event.preventBaseUIHandler();
              saveBundle();
            }}
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={label}
                className="text-[var(--text-secondary)] hover:text-foreground"
                data-testid="download-video"
              />
            }
          >
            <AnimatedIcon name="download" />
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="end" className="w-auto min-w-56" aria-label="Download video">
          <FormatItems formats={formats} download={download} exportText={exportText} meta={meta} />
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <IconButton
        label={label}
        hint={hint}
        tooltipAlign="end"
        aria-disabled={active || pending}
        onClick={(event) => {
          if (event.shiftKey) saveBundle();
          else if (!pending) void start();
        }}
        data-testid="download-video"
      >
        <AnimatedIcon name="download" />
      </IconButton>
    );

  return <DownloadProgress download={download}>{trigger}</DownloadProgress>;
}

function FormatItems({
  formats,
  download,
  exportText,
  meta,
}: {
  formats: readonly (PluginExportOption | 'core')[];
  download: VideoDownload;
  exportText: string;
  meta: ReplayMeta;
}) {
  const { canRender, stored, start } = download;
  return (
    <>
      {formats.map((format) =>
        format === 'core' ? (
          <Fragment key="core">
            {canRender ? (
              <DropdownMenuItem onClick={() => void start()} data-testid="export-video">
                {exportText}
              </DropdownMenuItem>
            ) : null}
            {stored ? (
              <DropdownMenuItem render={<a href={stored.href} download={videoFilename(meta.id)} data-testid="download-mp4" />}>
                Download original MP4
                {stored.size ? (
                  <DropdownMenuShortcut className="tracking-normal tabular-nums">{formatBytes(stored.size)}</DropdownMenuShortcut>
                ) : null}
              </DropdownMenuItem>
            ) : null}
          </Fragment>
        ) : (
          <DropdownMenuItem key={format.key} onClick={format.run} data-testid={format.key}>
            {format.label}
          </DropdownMenuItem>
        ),
      )}
    </>
  );
}

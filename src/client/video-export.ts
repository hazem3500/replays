/**
 * "Download video" for the replay viewer:
 *
 * - Stored MP4: `pnpm capture -- --video` uploads the agent's own screen
 *   recording next to the bundle (`meta.videoFile`); the viewer confirms it
 *   and links to it.
 * - Export: the server renders any replay to MP4 (headless Chromium + ffmpeg,
 *   src/server/renderer.ts). The client starts a job, polls it and downloads
 *   the file when it is done. The export follows the viewer's options: its
 *   playback speed, "skip inactive" and step captions (a RenderVariant, each
 *   combination rendered and cached separately).
 *
 * Everything above `useVideoRender` is pure and unit-tested in
 * test/video-export.test.ts.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { renderFilename, renderQuery, type RenderVariant, renderVariantParts } from '../shared/render-variant.ts';

export type RenderJobStatus = 'queued' | 'rendering' | 'done' | 'failed';

/** GET/POST <base>/api/replays/<id>/render. */
export interface RenderJob {
  jobId?: string;
  status: RenderJobStatus | 'none';
  progress?: number;
  etaMs?: number;
  error?: string;
  size?: number;
}

export type RenderAvailability = 'unknown' | 'available' | 'unavailable';

export type ExportState =
  | { kind: 'idle' }
  /** POST sent, no job yet. */
  | { kind: 'starting' }
  | { kind: 'queued' }
  | { kind: 'rendering'; progress: number; etaMs?: number }
  | { kind: 'error'; message: string };

export type ExportEvent =
  | { type: 'start' }
  | { type: 'job'; job: RenderJob }
  | { type: 'saved' }
  | { type: 'cancel' }
  | { type: 'dismiss' }
  | { type: 'failed'; message: string };

export const IDLE: ExportState = { kind: 'idle' };

/** States in which a job may be running and the client is polling it. */
export function isActive(state: ExportState) {
  return state.kind === 'starting' || state.kind === 'queued' || state.kind === 'rendering';
}

export function exportReducer(state: ExportState, event: ExportEvent): ExportState {
  switch (event.type) {
    case 'start':
      return isActive(state) ? state : { kind: 'starting' };
    case 'job': {
      if (!isActive(state)) return state;
      const { job } = event;
      if (job.status === 'queued') return { kind: 'queued' };
      if (job.status === 'rendering') {
        const progress = Math.min(1, Math.max(0, job.progress ?? 0));
        return job.etaMs === undefined ? { kind: 'rendering', progress } : { kind: 'rendering', progress, etaMs: job.etaMs };
      }
      if (job.status === 'failed') return { kind: 'error', message: `The render failed: ${job.error ?? 'unknown error'}` };
      if (job.status === 'none') return { kind: 'error', message: 'The render was cancelled.' };
      // 'done' keeps the last progress state until the download has been triggered ('saved').
      return { kind: 'rendering', progress: 1 };
    }
    case 'saved':
    case 'cancel':
      return IDLE;
    case 'dismiss':
      return state.kind === 'error' ? IDLE : state;
    case 'failed':
      return isActive(state) ? { kind: 'error', message: event.message } : state;
  }
}

/** The popover's one line: "Rendering video… 40%". */
export function progressLabel(state: ExportState) {
  switch (state.kind) {
    case 'starting':
      return 'Starting render…';
    case 'queued':
      return 'Waiting for another render…';
    case 'rendering':
      return `Rendering video… ${Math.floor(state.progress * 100)}%`;
    case 'error':
      return state.message;
    case 'idle':
      return '';
  }
}

/**
 * What the polite status region says: the phase, never the percentage, so a render polled every second
 * is announced once ("Rendering video…") instead of on every tick. The popover still shows the percentage.
 */
export function progressAnnouncement(state: ExportState) {
  return state.kind === 'rendering' ? 'Rendering video…' : progressLabel(state);
}

/** Plain-language message for a non-2xx render API response. */
export function describeRenderResponse(status: number, body: { error?: unknown } | undefined) {
  const detail = typeof body?.error === 'string' ? body.error : '';
  if (status === 503) return 'Video export is not available on this server.';
  if (status === 429) return 'Too many videos are rendering right now. Try again in a few minutes.';
  if (status === 404) return 'This replay no longer exists.';
  if (detail) return `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.`.replace(/\.\.$/, '.');
  return `The render request failed (${status}).`;
}

/** `<replay-id>.mp4`, or e.g. `<replay-id>-2x-captions.mp4` for a non-default variant (shared/render-variant.ts). */
export function videoFilename(replayId: string, variant: Partial<RenderVariant> = {}) {
  return renderFilename(replayId, variant);
}

/** The render API URL for one variant (`?speed=2&skipInactive=0&captions=1`; the default variant has no query). */
export function renderVariantUrl(renderUrl: string, variant: Partial<RenderVariant>, file = false) {
  return `${renderUrl}${file ? '/file' : ''}${renderQuery(variant)}`;
}

/** "Export video", or with the non-default options: "Export video · 2× · captions · full idle time". */
export function exportLabel(base: string, variant: Partial<RenderVariant>) {
  return [base, ...renderVariantParts(variant)].join(' · ');
}

export function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const POLL_MS = 1000;

/* ---------- browser side ---------- */

export function downloadUrl(href: string, filename: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

async function readJob(response: Response): Promise<RenderJob | undefined> {
  return (await response.json().catch(() => undefined)) as RenderJob | undefined;
}

/**
 * Starts, polls, cancels and downloads a server render of one replay.
 * `renderUrl` is the replay's `/render` API URL; `variant` (speed, skip inactive, captions) is what the next
 * export renders.
 */
export function useVideoRender(
  renderUrl: string,
  replayId: string,
  notify: (message: string) => void,
  variant: Partial<RenderVariant> = {},
) {
  const speed = variant.speed ?? 1;
  const skipInactive = variant.skipInactive ?? true;
  const captions = Boolean(variant.captions);
  const [state, dispatch] = useReducer(exportReducer, IDLE);
  const [availability, setAvailability] = useState<{ url: string; value: RenderAvailability }>({ url: renderUrl, value: 'unknown' });
  /** Bumped by start/cancel/unmount so a late POST answer cannot revive an abandoned render. */
  const generation = useRef(0);
  /** The variant of the job in flight: changing an option mid-render keeps polling (and saves) the job that was started. */
  const jobVariant = useRef<RenderVariant>({ speed, skipInactive, captions });
  const idle = useRef(true);
  useEffect(() => {
    idle.current = state.kind === 'idle';
  }, [state.kind]);

  const finish = useCallback(() => {
    const filename = videoFilename(replayId, jobVariant.current);
    downloadUrl(renderVariantUrl(renderUrl, jobVariant.current, true), filename);
    dispatch({ type: 'saved' });
    notify(`Saved ${filename}`);
  }, [notify, renderUrl, replayId]);

  const apply = useCallback(
    (job: RenderJob) => {
      if (job.status === 'done') finish();
      else dispatch({ type: 'job', job });
    },
    [finish],
  );

  // Availability (503 = Chromium/ffmpeg missing) and any render of this variant already running for this replay.
  useEffect(() => {
    const controller = new AbortController();
    const current = { speed, skipInactive, captions };
    fetch(renderVariantUrl(renderUrl, current), { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const job = response.ok ? await readJob(response) : undefined;
        // Current servers answer 200 { status: 'unavailable' }; older ones 503.
        const unavailable = response.status === 503 || (job as { status?: string } | undefined)?.status === 'unavailable';
        setAvailability({ url: renderUrl, value: unavailable ? 'unavailable' : 'available' });
        if (job && (job.status === 'queued' || job.status === 'rendering') && idle.current) {
          jobVariant.current = current;
          dispatch({ type: 'start' });
          dispatch({ type: 'job', job });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailability({ url: renderUrl, value: 'unavailable' });
      });
    return () => controller.abort();
  }, [renderUrl, speed, skipInactive, captions]);

  // Polls while a job is queued or rendering: every state change schedules the next poll.
  useEffect(() => {
    if (state.kind !== 'queued' && state.kind !== 'rendering') return;
    let stopped = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(renderVariantUrl(renderUrl, jobVariant.current), { cache: 'no-store' });
        const job = await readJob(response);
        if (stopped) return;
        if (response.status === 404) apply({ status: 'none' });
        else if (!response.ok || !job) dispatch({ type: 'failed', message: describeRenderResponse(response.status, job) });
        else apply(job);
      } catch (error) {
        if (!stopped) dispatch({ type: 'failed', message: error instanceof Error ? error.message : String(error) });
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [apply, renderUrl, state]);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const active = isActive(state);
  const start = useCallback(async () => {
    if (active) return;
    const run = ++generation.current;
    jobVariant.current = { speed, skipInactive, captions };
    dispatch({ type: 'start' });
    try {
      const response = await fetch(renderUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ speed, skipInactive, captions }),
      });
      const job = await readJob(response);
      if (run !== generation.current) return;
      if (!response.ok || !job) dispatch({ type: 'failed', message: describeRenderResponse(response.status, job) });
      else apply(job);
    } catch (error) {
      if (run === generation.current) dispatch({ type: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }, [active, apply, captions, renderUrl, skipInactive, speed]);

  const cancel = useCallback(() => {
    generation.current += 1;
    dispatch({ type: 'cancel' });
    void fetch(renderVariantUrl(renderUrl, jobVariant.current), { method: 'DELETE' }).catch(() => undefined);
  }, [renderUrl]);

  const dismiss = useCallback(() => dispatch({ type: 'dismiss' }), []);

  return {
    state,
    availability: availability.url === renderUrl ? availability.value : 'unknown',
    start,
    cancel,
    dismiss,
  };
}

import { access } from 'node:fs/promises';

import { editsVersion, type ReplayEdits } from '../shared/edits.ts';
import { PLAYBACK_SPEEDS, renderFilename } from '../shared/render-variant.ts';
import type { EditClient, RenderJob, RenderParams } from './client.ts';
import { EditError, usageError } from './errors.ts';

export function parseExportSpeed(text: string | undefined): number {
  if (text === undefined) return 1;
  const speed = Number(text.replace(/x$/i, ''));
  if (!PLAYBACK_SPEEDS.some((option) => option === speed)) throw usageError(`--speed must be one of ${PLAYBACK_SPEEDS.join(', ')}`);
  return speed;
}

export function exportParams(edits: ReplayEdits, options: { speed: number; captions: boolean; skipInactive: boolean }): RenderParams {
  return { ...options, edits: editsVersion(edits) };
}

export const defaultVideoName = (id: string, params: RenderParams) =>
  renderFilename(id, { speed: params.speed, captions: params.captions, skipInactive: params.skipInactive, edited: Boolean(params.edits) });

export async function assertFreeFile(file: string, force: boolean) {
  if (force) return;
  const exists = await access(file).then(
    () => true,
    () => false,
  );
  if (exists) throw new EditError(`${file} already exists; pass --force to overwrite it or -o to choose another file`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Starts (or joins) the export and polls until the video is ready; `onProgress` gets 0–1 and a status word. */
export async function renderVideo(
  client: Pick<EditClient, 'startRender' | 'renderStatus'>,
  params: RenderParams,
  options: { timeoutMs: number; pollMs?: number; onProgress?: (progress: number, status: string) => void },
): Promise<RenderJob> {
  const deadline = Date.now() + options.timeoutMs;
  let job = await client.startRender(params);
  for (;;) {
    if (job.status === 'done') return job;
    if (job.status === 'failed') throw new EditError(`the server could not render the video${job.error ? `: ${job.error}` : ''}`);
    if (job.status === 'unavailable' || job.status === 'refused')
      throw new EditError(`the server cannot render this video${(job.reason ?? job.error) ? ` (${job.reason ?? job.error})` : ''}`);
    if (job.status === 'none') throw new EditError('the server lost the export job; run the export again');
    options.onProgress?.(job.progress ?? 0, job.status);
    if (Date.now() >= deadline)
      throw new EditError(
        `the export is still ${job.status} after ${Math.round(options.timeoutMs / 1000)}s; run the same command again to keep waiting for it`,
      );
    await sleep(options.pollMs ?? 1000);
    job = await client.renderStatus(params);
  }
}

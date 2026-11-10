import type { UploadResult } from './bundle-io.ts';
import type { Terminal } from './terminal.ts';

/** The upload as a JSON line's fields: the id, the viewer link and, for a replay with a video, whether the video arrived. */
export function uploadFields(result: UploadResult) {
  return { id: result.id, url: result.url, ...(result.video ? { video: result.video } : {}) };
}

/** `✓ Replay uploaded`, plus `✗ video skipped: <reason>` when the video did not arrive, and the clickable viewer link. */
export function uploadSummary(out: Terminal, result: UploadResult) {
  const skipped = result.video && !result.video.uploaded;
  const status = `${out.ok('Replay uploaded')}${skipped ? ` · ${out.failed(`video skipped: ${result.video?.error ?? 'unknown error'}`)}` : ''}`;
  return `${status}\n\n${out.keyValue([['Replay', out.link(result.url)]])}`;
}

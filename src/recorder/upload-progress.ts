import type { RecorderState, RecordingSummary, UploadProgress } from './types.ts';
type ByteProgress = { loaded: number; total?: number };
type Options = { summary: RecordingSummary; state: () => RecorderState; setState: (state: RecorderState) => void; valid: () => boolean };
function measuredProgress({ loaded, total }: ByteProgress): UploadProgress {
  if (total === undefined) return { loaded: Math.max(0, loaded) };
  const fraction = total > 0 ? Math.min(1, Math.max(0, loaded / total)) : 0;
  return { loaded: Math.max(0, loaded), total, fraction };
}
export function createUploadProgress(options: Options): { update: (progress: ByteProgress) => void; dispose: () => void } {
  let lastProgress = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: ByteProgress | undefined;
  const flush = () => {
    timer = undefined;
    if (!options.valid() || options.state().status !== 'uploading' || !pending) return;
    lastProgress = Date.now();
    options.setState({ status: 'uploading', summary: options.summary, progress: measuredProgress(pending) });
  };
  return {
    update(progress) {
      if (!Number.isFinite(progress.loaded) || (progress.total !== undefined && !Number.isFinite(progress.total))) return;
      pending = progress;
      if (Date.now() - lastProgress >= 250) flush();
      else timer ??= setTimeout(flush, 250 - (Date.now() - lastProgress));
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}

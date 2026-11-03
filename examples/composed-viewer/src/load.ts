import { assertReplayBundle, type ReplayBundle } from '@hazem3500/replays/model';

/** Validates a local recording without uploading it or changing its capture privacy. */
export async function readRecording(file: File): Promise<ReplayBundle> {
  const value: unknown = JSON.parse(await file.text());
  assertReplayBundle(value);
  return value;
}

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createSession, type SessionOptions } from '../session.ts';
import type { UploadEndpoint } from '../upload-endpoint.ts';

/** One recorder for the life of the story; remount the story (a new `key`) to change its options. */
export function useRecorderSession(options: SessionOptions) {
  const [session] = useState(() => createSession(options));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => () => session.destroy(), [session]);
  return { recorder: session.recorder, ...snapshot };
}

export function useUploads(endpoint: UploadEndpoint) {
  return useSyncExternalStore(endpoint.subscribe, endpoint.uploads);
}

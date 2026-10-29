import type { Recorder, RecorderState, RecorderTrigger } from './types.ts';
import { resolveRecorderMessages, type RecorderMessageError, type RecorderMessageOverrides } from './messages.ts';

export type RecorderView =
  | 'idle'
  | 'asking'
  | 'starting'
  | 'recording'
  | 'reviewing'
  | 'sending'
  | 'sent'
  | 'failed-start'
  | 'failed-upload';
export const selectView = (state: RecorderState): RecorderView => {
  switch (state.status) {
    case 'consent':
      return 'asking';
    case 'review':
      return 'reviewing';
    case 'uploading':
      return 'sending';
    case 'uploaded':
      return 'sent';
    case 'error':
      return state.phase === 'start' ? 'failed-start' : 'failed-upload';
    case 'idle':
    case 'recording':
    case 'starting':
      return state.status;
  }
};
export const selectCanRequest = (state: RecorderState) =>
  ['idle', 'uploaded'].includes(state.status) || (state.status === 'error' && state.phase === 'start');
export const selectSummary = (state: RecorderState) => ('summary' in state ? state.summary : undefined);
export const selectReceipt = (state: RecorderState) => (state.status === 'uploaded' ? state.receipt : undefined);
export const selectUploadProgress = (state: RecorderState) => (state.status === 'uploading' ? state.progress : undefined);
/** `messages` supplies `failed` and `startFailed`; pass it via `store.select((state) => selectError(state, messages))`. */
export const selectError = (state: RecorderState, messages?: Pick<RecorderMessageOverrides, 'failed' | 'startFailed'>) => {
  if (state.status !== 'error') return;
  const error = state.error as RecorderMessageError;
  const copy = resolveRecorderMessages(messages);
  return {
    phase: state.phase,
    message:
      error.userMessage ??
      (state.phase === 'upload' ? copy.failed({ error, canRetry: Boolean(state.summary) }) : copy.startFailed({ error })),
    ...(error.link ? { link: error.link } : {}),
  };
};
export function createRecorderStore(recorder: Recorder) {
  return {
    getState: () => recorder.getState(),
    subscribe: (fn: () => void) => recorder.subscribe(fn),
    select<T>(selector: (state: RecorderState) => T, isEqual: (a: T, b: T) => boolean = Object.is) {
      let value = selector(recorder.getState());
      return {
        get() {
          const next = selector(recorder.getState());
          if (!isEqual(value, next)) value = next;
          return value;
        },
        subscribe(fn: () => void) {
          let previous = selector(recorder.getState());
          return recorder.subscribe((state) => {
            const next = selector(state);
            if (!isEqual(previous, next)) {
              previous = next;
              value = next;
              fn();
            }
          });
        },
      };
    },
    actions: {
      request: (trigger?: RecorderTrigger) => recorder.request(trigger),
      accept: () => recorder.respond({ consent: true }),
      decline: () => recorder.respond({ consent: false }),
      stop: () => {
        recorder.stop();
      },
      send: (note?: string) => recorder.respond({ upload: true, ...(note !== undefined ? { note } : {}) }),
      discard: () => recorder.discard(),
      retry: () => recorder.retryUpload(),
      dismiss: () => recorder.discard(),
    },
  };
}

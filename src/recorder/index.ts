/** Browser-only in-page recording. No server, Node or React imports. */
export { buildReplayBundle } from './bundle.ts';
export type * from './bundle-types.ts';
export * from './compat.ts';
export { DEFAULT_MESSAGES, defaultRecorderMessages, resolveRecorderMessages } from './messages.ts';
export type { RecorderMessageError, RecorderMessageOverrides, RecorderMessages } from './messages.ts';
export { createRecorderFormat, formatDuration, formatDurationLong, type RecorderFormat } from './format.ts';
export * from './timer.ts';
export * from './store.ts';
export * from './deferred-ui.ts';
export { blockSelector, blockProps, recorderUiProps, CHAT_WIDGET_PRESETS } from './privacy.ts';
export type { DefaultUiOptions, RecorderTheme, CompletionOptions, CompletionAction, CompletionContext } from './default-ui.ts';
export {
  BLOCK_ATTRIBUTE,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_DURATION_MS,
  MASK_INPUT_OPTIONS,
  MAX_BYTES_CEILING,
  MAX_DURATION_CEILING_MS,
  UI_ATTRIBUTE,
  createRecorder,
} from './recorder.ts';
export { DEFAULT_ALLOWED_HEADERS, redactText, redactUrl } from './redact.ts';
export type * from './types.ts';
export { IssueUploadError, createTokenUpload, gzip } from './upload.ts';
export { createHttpUpload, type HttpUploadHeaders, type HttpUploadOptions } from './http-upload.ts';
export type * from './upload.ts';

/** Browser-only in-page recording. No server, Node or React imports. */
export { buildReplayBundle } from './bundle.ts';
export type * from './bundle-types.ts';
export { createDefaultUi, DEFAULT_MESSAGES, formatDuration } from './default-ui.ts';
export type {
  DefaultUiOptions,
  RecorderMessages,
  RecorderTheme,
  CompletionOptions,
  CompletionAction,
  CompletionContext,
} from './default-ui.ts';
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
export type * from './upload.ts';

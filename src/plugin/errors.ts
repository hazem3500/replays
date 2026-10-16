/** Raised for every plugin problem found at start: validation, ordering, conflicts. `code` is stable API. */
export type PluginErrorCode =
  | 'invalid-plugin'
  | 'duplicate-plugin'
  | 'api-version'
  | 'missing-dependency'
  | 'dependency-cycle'
  | 'invalid-registration'
  | 'conflict'
  | 'setup-failed'
  | 'load-failed';

export class PluginError extends Error {
  readonly code: PluginErrorCode;
  readonly plugin: string | undefined;
  constructor(code: PluginErrorCode, message: string, options: { plugin?: string; cause?: unknown } = {}) {
    super(options.plugin ? `plugin ${options.plugin}: ${message}` : message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = 'PluginError';
    this.code = code;
    this.plugin = options.plugin;
  }
}

/** Throw from a `beforeUpload` (or any request) hook to answer with this status and message. */
export function rejectUpload(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

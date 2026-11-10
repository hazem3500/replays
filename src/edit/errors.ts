/** A failure with a message written for the person running the command; `exitCode` follows the CLI's exit codes (2 usage, 3 sign-in). */
export class EditError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

/** A value that the surrounding checks guarantee; a miss is a bug in the CLI, not in the input. */
export function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('internal error: a checked value was missing');
  return value;
}

export const usageError = (message: string) => new EditError(message, 2);

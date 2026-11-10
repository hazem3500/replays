/** A failure with a message written for the person running the command; `exitCode` follows the CLI's exit codes (2 usage, 3 sign-in). */
export class EditError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

export const usageError = (message: string) => new EditError(message, 2);

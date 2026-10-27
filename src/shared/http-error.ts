/** An error that answers the request with `status` and, below 500, its message. Throw it from any route or hook. */
export class HttpError extends Error {
  readonly status: number;
  readonly expose = true;
  constructor(status: number, message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = 'HttpError';
    this.status = status;
  }
}

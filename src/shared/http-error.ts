/**
 * An error that answers the request with `status`, `headers` and, below 500, its message. Throw it from any route or
 * hook. Lives in shared code so `/plugin` can export it without importing the server.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly expose = true;
  readonly headers: Readonly<Record<string, string>>;
  constructor(status: number, message: string, options: { cause?: unknown; headers?: Record<string, string> } = {}) {
    super(message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = 'HttpError';
    this.status = status;
    this.headers = Object.freeze({ ...options.headers });
  }
}

/** A `429 Too Many Requests` whose `Retry-After` is `retryAfterSeconds`, rounded up to at least one second. */
export function tooManyRequests(retryAfterSeconds: number, message = 'too many requests'): HttpError {
  const seconds = Number.isFinite(retryAfterSeconds) ? Math.max(1, Math.ceil(retryAfterSeconds)) : 60;
  return new HttpError(429, message, { headers: { 'retry-after': String(seconds) } });
}

/**
 * An error with the HTTP status it answers as (app.ts `fail()` reads `status`). The same shape as the
 * `Object.assign(new Error(message), { status })` errors elsewhere, so the mapping is unchanged.
 */
export class HttpStatusError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

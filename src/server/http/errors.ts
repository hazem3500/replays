import { HttpError } from '../../shared/http-error.ts';
import { NotFoundError, ObjectExistsError, PreconditionFailedError, StoredDataError } from '../storage/types.ts';

export { HttpError };

export const badJson = () => new HttpError(400, 'body is not valid JSON');

/** What a client is told about a failure: the status, and a message only when it is ours to show. */
export interface ErrorAnswer {
  status: number;
  /** The client-facing message; `internal error` for every 5xx. */
  message: string;
}

const answer = (status: number, message: string): ErrorAnswer => ({ status, message: status >= 500 ? 'internal error' : message });

const statusOf = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 400 && value < 600 ? value : undefined;

/**
 * The status and public message of a failed request. A status is trusted only from errors this server raises: `HttpError`,
 * our classes marked `expose`, and plain `Error`s given a `status` (`rejectUpload`'s older shape). A provider's status
 * (`GcsError`/`S3Error` 403/404/429) or a corrupt stored file never reaches the client: they are 500s. Storage errors keep
 * their status without naming keys. A plain `Error` without a status is input validation (the shared `assert*` checks): a 400.
 */
export function classifyError(error: unknown): ErrorAnswer {
  if (error instanceof StoredDataError) return { status: error.status, message: error.message };
  if (error instanceof NotFoundError) return answer(404, 'not found');
  if (error instanceof ObjectExistsError || error instanceof PreconditionFailedError) return answer(409, 'conflict');
  if (!(error instanceof Error)) return answer(500, '');
  const { status, expose, code, syscall } = error as Error & { status?: unknown; expose?: unknown; code?: unknown; syscall?: unknown };
  const explicit = statusOf(status);
  if (explicit !== undefined && (expose === true || error.constructor === Error)) return answer(explicit, error.message);
  if (code === 'ERR_INVALID_URL') return answer(400, error.message);
  if (error.constructor === Error && explicit === undefined && status === undefined && code === undefined && syscall === undefined)
    return answer(400, error.message);
  return answer(500, '');
}

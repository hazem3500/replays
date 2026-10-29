import type { IncomingMessage, ServerResponse } from 'node:http';

import { HttpError } from '../../shared/http-error.ts';
import { StoredDataError } from '../storage/types.ts';
import { recordError } from '../tracing.ts';
import { classifyError } from './errors.ts';
import { send, sendJson } from './send.ts';

/**
 * The error response for a failed request (`classifyError`): 4xx answer with their message as text, 5xx with a JSON body
 * (`StoredDataError`'s own message, else `internal error`). A thrown `HttpError` carries its headers (`Retry-After`). The
 * span gets the error's type only, never its message.
 */
export function fail(request: IncomingMessage, response: ServerResponse, error: unknown): void {
  const { status, message } = classifyError(error);
  recordError(error, status);
  const requestId = request.headers['x-request-id'] ?? request.headers['x-cloud-trace-context'] ?? '-';
  const path = (request.url ?? '').split('?')[0] ?? '';
  console.error(`request failed: ${request.method ?? ''} ${path} (request ${String(requestId)}, status ${status})`, error);
  const headers = error instanceof HttpError ? { ...error.headers } : {};
  if (response.headersSent) response.end();
  else if (status >= 500 || error instanceof StoredDataError) sendJson(response, status, { error: message }, { headers });
  else send(response, status, message, { headers });
}

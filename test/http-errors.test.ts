import { describe, expect, it } from 'vitest';

import { GcsError } from '../src/first-party/gcs.ts';
import { rejectUpload } from '../src/plugin/errors.ts';
import { classifyError, HttpError } from '../src/server/http/errors.ts';
import { NotFoundError, ObjectExistsError, PreconditionFailedError, StoredDataError } from '../src/server/storage/types.ts';
import { S3Error } from '../src/server/storage/s3.ts';
import { ReplayConflictError } from '../src/server/store.ts';
import { RenderQueueFullError } from '../src/server/render-queue.ts';

describe('error to HTTP mapping', () => {
  it('answers with the status and message of errors this server raises', () => {
    expect(classifyError(new HttpError(413, 'upload is larger than 25 MB'))).toEqual({
      status: 413,
      message: 'upload is larger than 25 MB',
    });
    expect(classifyError(rejectUpload(422, 'missing build id'))).toEqual({ status: 422, message: 'missing build id' });
    expect(classifyError(Object.assign(new Error('edit list too large'), { status: 413 }))).toEqual({
      status: 413,
      message: 'edit list too large',
    });
    expect(classifyError(new ReplayConflictError('demo'))).toEqual({ status: 409, message: 'replay demo already exists' });
    expect(classifyError(new RenderQueueFullError()).status).toBe(429);
  });

  it('treats a plain Error as input validation, and a bad URL as a bad request', () => {
    expect(classifyError(new Error('replay id must contain lowercase letters'))).toEqual({
      status: 400,
      message: 'replay id must contain lowercase letters',
    });
    expect(classifyError(Object.assign(new TypeError('Invalid URL'), { code: 'ERR_INVALID_URL' })).status).toBe(400);
  });

  it('never passes a provider status or a storage key to the client', () => {
    expect(classifyError(new GcsError(403, 'storage.objects.get denied for bucket acme-private'))).toEqual({
      status: 500,
      message: 'internal error',
    });
    expect(classifyError(new S3Error(429, 'SlowDown', 'Please reduce your request rate'))).toEqual({
      status: 500,
      message: 'internal error',
    });
    expect(classifyError(new NotFoundError('replays/demo/bundle.json'))).toEqual({ status: 404, message: 'not found' });
    expect(classifyError(new ObjectExistsError('replays/demo/bundle.json'))).toEqual({ status: 409, message: 'conflict' });
    expect(classifyError(new PreconditionFailedError('replays/demo/edits.json'))).toEqual({ status: 409, message: 'conflict' });
  });

  it('keeps the stored-data message, which tells the client to retry or restore before saving', () => {
    expect(classifyError(new StoredDataError('Stored data could not be read; retry before saving.'))).toEqual({
      status: 503,
      message: 'Stored data could not be read; retry before saving.',
    });
  });

  it('hides everything else behind a generic 500', () => {
    expect(classifyError(new SyntaxError('Unexpected token < in stored JSON'))).toEqual({ status: 500, message: 'internal error' });
    expect(classifyError(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT', syscall: 'open' }))).toEqual({
      status: 500,
      message: 'internal error',
    });
    expect(classifyError(new HttpError(503, 'render queue is shutting down'))).toEqual({ status: 503, message: 'internal error' });
    expect(classifyError('a string')).toEqual({ status: 500, message: 'internal error' });
  });
});

import { apiUrl } from '../api/fetch.ts';
import { compressBody, type PreparedUpload, type UploadEdits, UploadError, uploadErrorMessage, uploadRequest } from './prepare.ts';

export interface UploadProgress {
  loaded: number;
  total: number;
}

/**
 * Sends the upload with XHR so upload progress is observable (fetch has no upload progress
 * without duplex streams). Resolves with the stored replay's id, plus its review suite when it is a suite run.
 */
export async function sendUpload(
  prepared: PreparedUpload,
  edits: UploadEdits,
  onProgress: (progress: UploadProgress) => void,
  signal: AbortSignal,
): Promise<{ id: string; suiteId?: string }> {
  const request = uploadRequest(prepared, edits);
  const { body, encoding } = await compressBody(request.body);
  if (signal.aborted) throw new DOMException('Upload cancelled', 'AbortError');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl(request.path));
    xhr.setRequestHeader('content-type', 'application/json');
    if (encoding) xhr.setRequestHeader('content-encoding', encoding);
    xhr.upload.addEventListener('progress', (event) =>
      onProgress({ loaded: event.loaded, total: event.lengthComputable ? event.total : body.size }),
    );
    xhr.addEventListener('load', () => {
      if (xhr.status === 200 || xhr.status === 201) {
        try {
          const receipt = JSON.parse(xhr.responseText) as { id?: unknown; suiteId?: unknown };
          if (typeof receipt.id === 'string')
            return resolve({ id: receipt.id, ...(typeof receipt.suiteId === 'string' ? { suiteId: receipt.suiteId } : {}) });
        } catch {
          // Fall through to the generic error below.
        }
        return reject(new UploadError('The server stored the replay but sent an unexpected reply. Check the replay list.'));
      }
      reject(uploadErrorMessage(xhr.status, xhr.responseText, request.id));
    });
    xhr.addEventListener('error', () =>
      reject(new UploadError('The upload did not reach the server. Check your connection and try again.')),
    );
    xhr.addEventListener('abort', () => reject(new DOMException('Upload cancelled', 'AbortError')));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    onProgress({ loaded: 0, total: body.size });
    xhr.send(body);
  });
}

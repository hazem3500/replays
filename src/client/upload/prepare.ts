// Browser-side reading and classification of an upload, before anything is sent.
// The rrweb checks are the same pure functions the server's import route runs.
import { describeRecording, parseRrwebExport } from '../../capture/human-bundle.ts';
import { assertReplayBundle, isReplayTag, MAX_TAGS, type ReplayBundle } from '../../shared/replay.ts';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_FILES = '.json,.gz,application/json,application/gzip';

export type UploadKind = 'bundle' | 'rrweb';

export interface PreparedUpload {
  kind: UploadKind;
  fileName: string;
  /** Uncompressed JSON size in bytes. */
  size: number;
  eventCount: number;
  duration: number;
  viewport: { width: number; height: number };
  /** Start URL from the file, if it has one. */
  startUrl?: string;
  /** Title to prefill: the bundle's own title, or one made from the file name. */
  title: string;
  /** The JSON as read (rrweb uploads are sent as-is; bundles are re-serialized with edits). */
  text: string;
  bundle?: ReplayBundle;
}

export class UploadError extends Error {
  readonly existingId: string | undefined;

  constructor(message: string, existingId?: string) {
    super(message);
    this.existingId = existingId;
  }
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

export function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} kB` : megabytes(bytes);
}

/** "checkout-bug_2026.json.gz" → "checkout bug 2026". */
export function titleFromFileName(name: string) {
  const stem = name
    .replace(/\.gz$/i, '')
    .replace(/\.json$/i, '')
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stem || /^(replay|events|recording)$/i.test(stem)) return 'Uploaded recording';
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

function looksLikeBundle(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Boolean(record.meta && typeof record.meta === 'object' && Array.isArray(record.events) && Array.isArray(record.steps));
}

/** Decides whether parsed JSON is a replay bundle or plain rrweb events and summarizes it. */
export function classifyUpload(value: unknown, fileName: string, text: string): PreparedUpload {
  const size = new TextEncoder().encode(text).byteLength;
  if (looksLikeBundle(value)) {
    try {
      assertReplayBundle(value);
    } catch (error) {
      throw new UploadError(`This looks like a replay bundle, but it is not valid: ${(error as Error).message}.`);
    }
    const { meta, events } = value;
    return {
      kind: 'bundle',
      fileName,
      size,
      eventCount: events.length,
      duration: meta.duration,
      viewport: meta.viewport,
      ...(meta.url ? { startUrl: meta.url } : {}),
      title: meta.title.trim() || titleFromFileName(fileName),
      text,
      bundle: value,
    };
  }
  let events;
  try {
    events = parseRrwebExport(value);
  } catch (error) {
    throw new UploadError(`This is not a replay bundle or an rrweb recording: ${(error as Error).message}.`);
  }
  const info = describeRecording(events);
  return {
    kind: 'rrweb',
    fileName,
    size,
    eventCount: info.eventCount,
    duration: info.duration,
    viewport: info.viewport,
    ...(info.startUrl ? { startUrl: info.startUrl } : {}),
    title: titleFromFileName(fileName),
    text,
  };
}

async function isGzip(file: Blob) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  return head[0] === 0x1f && head[1] === 0x8b;
}

/** Reads text, decompressing gzip (by magic bytes, not just the name) and stopping past the size limit. */
async function readText(file: File) {
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError(`This file is ${megabytes(file.size)}; uploads are limited to 25 MB.`);
  if (!(await isGzip(file))) return file.text();
  if (typeof DecompressionStream === 'undefined') throw new UploadError('This browser cannot open .gz files. Decompress it first.');
  const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_UPLOAD_BYTES) {
        await reader.cancel();
        throw new UploadError('Decompressed, this file is larger than the 25 MB upload limit.');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError('This .gz file could not be decompressed.');
  }
  return new TextDecoder().decode(await new Blob(chunks as BlobPart[]).arrayBuffer());
}

export async function prepareUpload(file: File): Promise<PreparedUpload> {
  if (!/\.json(\.gz)?$|\.gz$/i.test(file.name) && !/json|gzip/.test(file.type))
    throw new UploadError('Choose a .json or .json.gz file: a replay.json bundle or an rrweb export.');
  const text = await readText(file);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UploadError('This file is not valid JSON.');
  }
  return classifyUpload(value, file.name, text);
}

/** Tags typed as a list ("smoke, checkout"): lower-cased, de-duplicated, and the entries the server would refuse. */
export function parseTags(text: string) {
  const tags: string[] = [];
  const invalid: string[] = [];
  for (const word of text.toLowerCase().split(/[\s,]+/)) {
    if (!word || tags.includes(word) || invalid.includes(word)) continue;
    (isReplayTag(word) ? tags : invalid).push(word);
  }
  return { tags, invalid, tooMany: tags.length > MAX_TAGS };
}

export interface UploadEdits {
  title: string;
  url: string;
  /** Tags from the dialog; `[]` clears them, `undefined` keeps the bundle's own `meta.tags`. */
  tags?: string[];
  /** The purpose picked in the dialog; `''` clears it, `undefined` keeps the bundle's own `meta.purpose`. */
  purpose?: string;
}

/** Body and endpoint for the upload; bundles carry the edited title, start URL and tags in `meta`. */
export function uploadRequest(prepared: PreparedUpload, edits: UploadEdits) {
  const title = edits.title.trim();
  const url = edits.url.trim();
  if (prepared.kind === 'bundle' && prepared.bundle) {
    // Assigning in place keeps meta's key order, so an unchanged suite re-upload still compares equal.
    const meta: ReplayBundle['meta'] = { ...prepared.bundle.meta, title, ...(url ? { url } : {}) };
    if (edits.tags && edits.tags.length === 0) delete meta.tags;
    else if (edits.tags) meta.tags = edits.tags;
    if (edits.purpose === '') delete meta.purpose;
    else if (edits.purpose) meta.purpose = edits.purpose;
    const bundle: ReplayBundle = { ...prepared.bundle, meta };
    return { path: 'replays', body: JSON.stringify(bundle), id: bundle.meta.id };
  }
  const params = new URLSearchParams({ title });
  if (url) params.set('url', url);
  for (const tag of edits.tags ?? []) params.append('tag', tag);
  if (edits.purpose) params.set('purpose', edits.purpose);
  return { path: `replays/import?${params}`, body: prepared.text };
}

/** Calm, actionable copy for a failed upload response. */
export function uploadErrorMessage(status: number, body: string, bundleId?: string) {
  const detail = body.trim().replace(/\.$/, '');
  // 409 also covers review-suite conflicts ("review suite run already has a different recording"); only an
  // id clash means a stored replay exists to link to.
  if (status === 409 && (!detail || /already exists/i.test(detail))) {
    return bundleId
      ? new UploadError('A replay with this id is already stored.', bundleId)
      : new UploadError('A replay with this id is already stored.');
  }
  if (status === 413) return new UploadError('This file is larger than the 25 MB upload limit.');
  if (status === 403) return new UploadError('Your session could not be verified. Reload the page and try again.');
  if (status >= 500 || !detail) return new UploadError(`The server could not store this replay (${status}). Try again in a moment.`);
  return new UploadError(`The server rejected this file: ${detail}.`);
}

/** gzip in the browser when supported; the server accepts `Content-Encoding: gzip`. */
export async function compressBody(body: string): Promise<{ body: Blob; encoding?: 'gzip' }> {
  const blob = new Blob([body], { type: 'application/json' });
  if (typeof CompressionStream === 'undefined' || blob.size < 64 * 1024) return { body: blob };
  const compressed = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
  return { body: compressed, encoding: 'gzip' };
}

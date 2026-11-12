import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

import { isProfileId, readAliased } from '../shared/profiles.ts';
import { REPLAY_FORMAT_VERSION, type ReplayBundle } from '../shared/replay.ts';
import { normalizeUploadUrl } from './server-config.ts';

// why: shared by the capture CLI and the rrweb import CLI.

/** `--profile <id>`, else the deprecated `--purpose <id>` (with a warning); checked as a profile id. */
export function profileFlag(
  values: Readonly<Record<string, string | undefined>>,
  warn: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): string | undefined {
  if (values.purpose !== undefined) warn('warning: --purpose is deprecated; use --profile');
  const profile = readAliased(values.profile, values.purpose, '--profile and --purpose');
  if (profile !== undefined && !isProfileId(profile))
    throw new Error('--profile must be a profile id (lower-case letters, digits and "-")');
  return profile;
}

/**
 * `--name value` flags; names in `booleans` take no value. A bare `--` is ignored (pnpm passes it through).
 * `values` keeps the last value of each flag, `lists` every value in order (repeatable flags such as --person).
 */
export function flagMap(argv: string[], booleanFlags: ReadonlySet<string> = new Set()) {
  const values: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  const booleans = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === '--') continue;
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const name = token.slice(2);
    if (booleanFlags.has(name)) {
      booleans.add(name);
      continue;
    }
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`--${name} takes a value`);
    values[name] = value;
    (lists[name] ??= []).push(value);
  }
  return { values, lists, booleans };
}

export { defaultId } from './human-bundle.ts';

const SCHEMA_STATUSES = new Set([400, 422]);
const MAX_DETAIL = 300;

/** The format-mismatch advice for a bundle the server refused as invalid; `update` names the command that moves the CLI forward. */
export function formatAdvice(serverFormat: number | undefined, update = 'replays update') {
  const expects = serverFormat === undefined ? 'an older or unreported one' : String(serverFormat);
  return `This CLI writes format ${REPLAY_FORMAT_VERSION}; the server expects ${expects}. Update with \`${update}\`, or the server needs a newer pin.`;
}

export class UploadHttpError extends Error {
  readonly status: number;
  readonly video: boolean;
  /** The bundle format the server reported in `x-replays-format`, when it did. */
  readonly serverFormat: number | undefined;

  constructor(status: number, video = false, options: { detail?: string; serverFormat?: number; update?: string } = {}) {
    const base = video ? `video upload failed (${status})` : `replay upload failed (${status})`;
    const schema = !video && SCHEMA_STATUSES.has(status);
    const detail = options.detail ? `: ${options.detail}` : '';
    super(schema ? `${base}${detail}. ${formatAdvice(options.serverFormat, options.update)}` : `${base}${detail}`);
    this.status = status;
    this.video = video;
    this.serverFormat = options.serverFormat;
  }
}

async function uploadRequest(url: string, init: RequestInit) {
  try {
    return await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error('could not reach upload server; check the configured URL and network');
  }
}

async function rejection(response: Response, video: boolean, env: NodeJS.ProcessEnv) {
  const header = Number(response.headers.get('x-replays-format'));
  const text = SCHEMA_STATUSES.has(response.status) ? (await response.text().catch(() => '')).trim().slice(0, MAX_DETAIL) : '';
  const detail = text.startsWith('{') ? undefined : text;
  return new UploadHttpError(response.status, video, {
    ...(detail ? { detail } : {}),
    ...(Number.isInteger(header) && header > 0 ? { serverFormat: header } : {}),
    ...(env.REPLAYS_UPDATE_COMMAND ? { update: env.REPLAYS_UPDATE_COMMAND } : {}),
  });
}

export interface UploadResult {
  id: string;
  /** The canonical viewer link: the server's own `url` when it sent one, else `<server>/r/<id>`. */
  url: string;
  /** Present when the replay has a video; a failed video upload does not fail the replay. */
  video?: { uploaded: boolean; error?: string };
}

/** The viewer link for an uploaded replay: the receipt's `url` (absolute, or a path on the server's origin), else `<server>/r/<id>`. */
export function receiptUrl(endpoint: string, id: string, receipt: unknown): string {
  const origin = new URL(endpoint);
  const given = typeof receipt === 'object' && receipt !== null && 'url' in receipt ? receipt.url : undefined;
  if (typeof given === 'string' && given) {
    try {
      const resolved = new URL(given, origin);
      if (resolved.origin === origin.origin && !resolved.username && !resolved.password) return resolved.href;
    } catch {
      // why: a malformed receipt url falls back to the derived link.
    }
  }
  const base = endpoint.endsWith('/api/replays') ? endpoint.slice(0, -'/api/replays'.length) : origin.origin;
  return `${base}/r/${encodeURIComponent(id)}`;
}

function videoFailure(error: unknown) {
  if (error instanceof UploadHttpError) return `server refused the video (${error.status})`;
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 'the video file was not found next to replay.json';
  return error instanceof Error ? error.message : String(error);
}

/** PUTs the MP4 for an already uploaded replay. Never throws: the result says whether the video arrived and why not. */
async function uploadVideo(bundle: ReplayBundle, output: string, endpoint: string, headers: Record<string, string>) {
  try {
    const video = await readFile(join(output, bundle.meta.videoFile!));
    const uploaded = await uploadRequest(`${endpoint}/${bundle.meta.id}/video`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'video/mp4' },
      body: new Uint8Array(video),
    });
    if (uploaded.status >= 300 && uploaded.status < 400)
      throw new Error('video upload was redirected; check the configured server URL and sign-in setup');
    if (!uploaded.ok) throw new UploadHttpError(uploaded.status, true);
    return { uploaded: true };
  } catch (error) {
    return { uploaded: false, error: videoFailure(error) };
  }
}

/**
 * POSTs the bundle to a replay server's upload endpoint (`<server>/api/replays`), then its optional MP4. The replay is
 * saved once the first request succeeds, so a video that cannot be read or sent is reported in the result, not thrown.
 */
export async function upload(
  bundle: ReplayBundle,
  output: string,
  url: string,
  headerFile?: string,
  accessToken?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<UploadResult> {
  const parsed: unknown = headerFile ? JSON.parse(await readFile(resolve(headerFile), 'utf8')) : {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== 'string'))
    throw new Error('--header-file must contain a JSON object with string header values');
  const headers = {
    ...(parsed as Record<string, string>),
    ...(headerFile || !accessToken ? {} : { authorization: `Bearer ${accessToken}` }),
  };
  const endpoint = normalizeUploadUrl(url);
  const json = JSON.stringify(bundle);
  // why: bundles run to 17 MB against a 25 MB cap and gzip to about 4%; an older server answers 415, so it gets one plain retry.
  let response = await uploadRequest(endpoint, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', 'content-encoding': 'gzip' },
    body: new Uint8Array(gzipSync(json)),
  });
  if (response.status === 415)
    response = await uploadRequest(endpoint, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: json });
  if (response.status >= 300 && response.status < 400)
    throw new Error('replay upload was redirected; check the configured server URL and sign-in setup');
  if (response.status === 401 || response.status === 403) throw new UploadHttpError(response.status);
  if (!response.ok) throw await rejection(response, false, env);
  const receipt: unknown = await response.json().catch(() => undefined);
  const result: UploadResult = { id: bundle.meta.id, url: receiptUrl(endpoint, bundle.meta.id, receipt) };
  if (bundle.meta.videoFile) result.video = await uploadVideo(bundle, output, endpoint, headers);
  return result;
}

export async function prepareOutputDirectory(output: string) {
  await mkdir(output, { recursive: true });
  const entries = await readdir(output);
  if (entries.length > 0) throw new Error(`--output directory must be empty: ${output}`);
}

import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { ReplayBundle } from '../shared/replay.ts';
import { normalizeUploadUrl } from './server-config.ts';

// Shared by the capture CLI and the rrweb import CLI.

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

export class UploadHttpError extends Error {
  readonly status: number;
  readonly video: boolean;

  constructor(status: number, video = false) {
    super(video ? `video upload failed (${status})` : `replay upload failed (${status})`);
    this.status = status;
    this.video = video;
  }
}

async function uploadRequest(url: string, init: RequestInit) {
  try {
    return await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error('could not reach upload server; check the configured URL and network');
  }
}

/** POSTs the bundle (and its optional MP4) to a replay server's upload endpoint (`<server>/api/replays`). */
export async function upload(bundle: ReplayBundle, output: string, url: string, headerFile?: string, accessToken?: string) {
  const parsed: unknown = headerFile ? JSON.parse(await readFile(resolve(headerFile), 'utf8')) : {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== 'string'))
    throw new Error('--header-file must contain a JSON object with string header values');
  const headers = {
    ...(parsed as Record<string, string>),
    ...(headerFile || !accessToken ? {} : { authorization: `Bearer ${accessToken}` }),
  };
  const endpoint = normalizeUploadUrl(url);
  const response = await uploadRequest(endpoint, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(bundle),
  });
  if (response.status >= 300 && response.status < 400)
    throw new Error('replay upload was redirected; check the configured server URL and sign-in setup');
  if (response.status === 401 || response.status === 403) throw new UploadHttpError(response.status);
  if (!response.ok) throw new UploadHttpError(response.status);
  if (bundle.meta.videoFile) {
    const video = await readFile(join(output, bundle.meta.videoFile));
    const uploaded = await uploadRequest(`${endpoint}/${bundle.meta.id}/video`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'video/mp4' },
      body: new Uint8Array(video),
    });
    if (uploaded.status >= 300 && uploaded.status < 400)
      throw new Error('video upload was redirected; check the configured server URL and sign-in setup');
    if (uploaded.status === 401 || uploaded.status === 403) throw new UploadHttpError(uploaded.status, true);
    if (!uploaded.ok) throw new UploadHttpError(uploaded.status, true);
  }
}

export async function prepareOutputDirectory(output: string) {
  await mkdir(output, { recursive: true });
  const entries = await readdir(output);
  if (entries.length > 0) throw new Error(`--output directory must be empty: ${output}`);
}

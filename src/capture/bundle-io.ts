import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { ReplayBundle } from '../shared/replay.ts';

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

/** POSTs the bundle (and its optional MP4) to a replay server's upload endpoint (`<server>/api/replays`). */
export async function upload(bundle: ReplayBundle, output: string, url: string, headerFile?: string) {
  const headers = headerFile ? (JSON.parse(await readFile(resolve(headerFile), 'utf8')) as Record<string, string>) : {};
  const endpoint = url.replace(/\/$/, '');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(bundle),
  });
  if (!response.ok) throw new Error(`replay upload failed (${response.status})`);
  if (bundle.meta.videoFile) {
    const video = await readFile(join(output, bundle.meta.videoFile));
    const uploaded = await fetch(`${endpoint}/${bundle.meta.id}/video`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'video/mp4' },
      body: new Uint8Array(video),
    });
    if (!uploaded.ok) throw new Error(`video upload failed (${uploaded.status})`);
  }
}

export async function prepareOutputDirectory(output: string) {
  await mkdir(output, { recursive: true });
  const entries = await readdir(output);
  if (entries.length > 0) throw new Error(`--output directory must be empty: ${output}`);
}

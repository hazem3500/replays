import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Checks a `--state` file and returns its absolute path. It is a Playwright storage state: JSON with `cookies` and/or
 * `origins`. agent-browser reads the same shape, so one file works for both drivers.
 */
export async function readStateFile(path: string): Promise<string> {
  const file = resolve(path);
  const text = await readFile(file, 'utf8').catch(() => Promise.reject(new Error(`--state: cannot read ${file}`)));
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`--state: ${file} is not JSON; expected a Playwright storage state (cookies and origins)`);
  }
  const shape = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : undefined;
  if (!shape || !('cookies' in shape || 'origins' in shape))
    throw new Error(`--state: ${file} is not a Playwright storage state (JSON with cookies and origins)`);
  return file;
}

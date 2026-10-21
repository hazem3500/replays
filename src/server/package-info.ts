import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** The package root: the repository when run from source, the installed package when run from `dist/lib` (or its chunks). */
export function findPackageRoot() {
  for (let dir = import.meta.dirname; dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(resolve(dir, 'package.json')) && existsSync(resolve(dir, 'bin/replays.mjs'))) return dir;
  }
  return resolve(import.meta.dirname, '../..');
}

let cached: string | undefined;

/** This package's version (`package.json`): the "core" a kept user plugin records in its manifest's `targets`. */
export function coreVersion() {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(readFileSync(resolve(findPackageRoot(), 'package.json'), 'utf8')) as { version?: unknown };
    cached = typeof parsed.version === 'string' && parsed.version ? parsed.version : '0.0.0';
  } catch {
    cached = '0.0.0';
  }
  return cached;
}

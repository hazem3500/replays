import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** The package root: the repository when run from source, the installed package when run from `dist/lib` or `dist/cli`. */
export function findPackageRoot(from = import.meta.dirname) {
  for (let dir = from; dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(resolve(dir, 'package.json')) && existsSync(resolve(dir, 'bin/replays.mjs'))) return dir;
  }
  return resolve(from, '../..');
}

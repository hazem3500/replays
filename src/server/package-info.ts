import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { findPackageRoot } from './package-root.ts';

export { findPackageRoot };

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

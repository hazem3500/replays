import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { CaptureDriver } from './drivers/types.ts';

/**
 * A `shot` step's PNG. `step` is the 1-based position of the step in the replay (`#step-<n>` opens it on what the still
 * shows); `at` is its time on the replay clock, in ms.
 */
export interface CapturedShot {
  name: string;
  /** Absolute path of the PNG: `<output>/shots/<name>.png`. */
  file: string;
  label: string;
  step: number;
  at: number;
}

/** Saves the PNG of a `shot` step under `<output>/shots/` and returns its path. */
export async function saveShot(driver: CaptureDriver, output: string, name: string): Promise<string> {
  if (!driver.screenshot) throw new Error(`a shot step needs a driver that can take screenshots; ${driver.name} cannot`);
  const directory = join(output, 'shots');
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${name}.png`);
  await driver.screenshot(file);
  return file;
}

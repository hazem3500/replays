import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { isPurposeId } from '../shared/purposes.ts';
import { assertReplayBundle } from '../shared/replay.ts';
import { flagMap, upload } from './bundle-io.ts';

/** `replays upload <replay.json> --upload-url <server>/api/replays [--header-file file] [--purpose id]` */
export async function runUploadCli(argv: string[]) {
  try {
    const [file, ...flags] = argv;
    if (!file || file.startsWith('--'))
      throw new Error('usage: replays upload <replay.json> --upload-url <server>/api/replays [--header-file file] [--purpose id]');
    const { values } = flagMap(flags);
    if (!values['upload-url']) throw new Error('--upload-url is required');
    const bundle: unknown = JSON.parse(await readFile(resolve(file), 'utf8'));
    assertReplayBundle(bundle);
    // --purpose sets (or replaces) meta.purpose; the server checks it against its purposes.
    if (values.purpose !== undefined) {
      if (!isPurposeId(values.purpose)) throw new Error('--purpose must be a purpose id (lower-case letters, digits and "-")');
      bundle.meta.purpose = values.purpose;
    }
    await upload(bundle, dirname(resolve(file)), values['upload-url'], values['header-file']);
    process.stdout.write(`${JSON.stringify({ success: true, id: bundle.meta.id })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  }
}

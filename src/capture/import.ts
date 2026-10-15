// Imports a plain rrweb recording made by a person (rrweb record() snippet,
// the rrweb browser extension, or another tool's export) as a replay.
// Run with `replays import --rrweb <events.json> --title "..."`. Optional: --url, --id,
// --tag <tag> (repeatable), --output, --upload-url, --header-file.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { assertReplayTags } from '../shared/replay.ts';
import { buildHumanBundle } from './human-bundle.ts';
import { flagMap, prepareOutputDirectory, upload } from './bundle-io.ts';

// The conversion itself is pure and shared with the server's import route.
export { buildHumanBundle, describeRecording, parseRrwebExport, type HumanImportOptions } from './human-bundle.ts';

export async function importRecording(args: {
  rrweb: string;
  title: string;
  url?: string;
  id?: string;
  tags?: string[];
  output?: string;
  uploadUrl?: string;
  headerFile?: string;
}) {
  // Validate flags before reading the recording.
  if (args.tags?.length) assertReplayTags(args.tags, '--tag');
  const source: unknown = JSON.parse(await readFile(resolve(args.rrweb), 'utf8'));
  const bundle = buildHumanBundle(source, {
    title: args.title,
    ...(args.url ? { url: args.url } : {}),
    ...(args.id ? { id: args.id } : {}),
    ...(args.tags?.length ? { tags: args.tags } : {}),
  });
  const output = resolve(args.output ?? join('.data', bundle.meta.id));
  await prepareOutputDirectory(output);
  const replayPath = join(output, 'replay.json');
  await writeFile(replayPath, `${JSON.stringify(bundle)}\n`, { flag: 'wx' });
  if (args.uploadUrl) await upload(bundle, output, args.uploadUrl, args.headerFile);
  return { replayPath, id: bundle.meta.id, eventCount: bundle.events.length, duration: bundle.meta.duration };
}

/** `replays import …` */
export async function runImportCli(argv: string[]) {
  try {
    const { values, lists } = flagMap(argv);
    if (!values.rrweb) throw new Error('--rrweb <events.json> is required');
    if (!values.title) throw new Error('--title is required');
    const result = await importRecording({
      rrweb: values.rrweb,
      title: values.title,
      ...(values.url ? { url: values.url } : {}),
      ...(values.id ? { id: values.id } : {}),
      ...(lists.tag ? { tags: lists.tag } : {}),
      ...(values.output ? { output: values.output } : {}),
      ...(values['upload-url'] ? { uploadUrl: values['upload-url'] } : {}),
      ...(values['header-file'] ? { headerFile: values['header-file'] } : {}),
    });
    process.stdout.write(`${JSON.stringify({ success: true, ...result })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  }
}

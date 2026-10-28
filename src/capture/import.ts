// Imports a plain rrweb recording made by a person (rrweb record() snippet,
// the rrweb browser extension, or another tool's export) as a replay.
// Run with `replays import --rrweb <events.json> --title "..."`. Optional: --url, --id,
// --tag <tag> and --person role:email[:handle=value] (both repeatable), --profile <id>, --output, --upload-url, --header-file.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { parsePeopleFlags } from '../shared/people.ts';
import { profileOf } from '../shared/profiles.ts';
import { assertReplayTags } from '../shared/replay.ts';
import { buildHumanBundle } from './human-bundle.ts';
import { flagMap, prepareOutputDirectory, profileFlag } from './bundle-io.ts';
import { uploadConfigured } from './upload.ts';

// The conversion itself is pure and shared with the server's import route.
export { buildHumanBundle, describeRecording, parseRrwebExport, type HumanImportOptions } from './human-bundle.ts';

export async function importRecording(args: {
  rrweb: string;
  title: string;
  url?: string;
  id?: string;
  tags?: string[];
  profile?: string;
  /** @deprecated Use `profile`. */
  purpose?: string;
  /** `role:email[:handle=value]` values of repeatable --person flags. */
  person?: string[];
  output?: string;
  uploadUrl?: string;
  headerFile?: string;
  upload?: boolean;
  login?: boolean;
  serverName?: string;
}) {
  // Validate flags before reading the recording.
  if (args.tags?.length) assertReplayTags(args.tags, '--tag');
  const people = parsePeopleFlags(args.person ?? []);
  const source: unknown = JSON.parse(await readFile(resolve(args.rrweb), 'utf8'));
  const profile = profileOf(args);
  const bundle = buildHumanBundle(source, {
    title: args.title,
    ...(args.url ? { url: args.url } : {}),
    ...(args.id ? { id: args.id } : {}),
    ...(args.tags?.length ? { tags: args.tags } : {}),
    ...(profile ? { profile } : {}),
    ...(people.length ? { people } : {}),
  });
  const output = resolve(args.output ?? join('.data', bundle.meta.id));
  await prepareOutputDirectory(output);
  const replayPath = join(output, 'replay.json');
  await writeFile(replayPath, `${JSON.stringify(bundle)}\n`, { flag: 'wx' });
  if (args.upload || args.uploadUrl)
    await uploadConfigured(bundle, output, {
      ...(args.uploadUrl ? { uploadUrl: args.uploadUrl } : {}),
      ...(args.serverName ? { serverName: args.serverName } : {}),
      ...(args.headerFile ? { headerFile: args.headerFile } : {}),
      ...(args.login ? { forceLogin: true } : {}),
    });
  return { replayPath, id: bundle.meta.id, eventCount: bundle.events.length, duration: bundle.meta.duration };
}

/** `replays import …` */
export async function runImportCli(argv: string[]) {
  try {
    const { values, lists, booleans } = flagMap(argv, new Set(['upload', 'login']));
    if (booleans.has('login') && !booleans.has('upload') && !values['upload-url'])
      throw new Error('--login requires --upload or --upload-url');
    if (!values.rrweb) throw new Error('--rrweb <events.json> is required');
    if (!values.title) throw new Error('--title is required');
    const profile = profileFlag(values);
    const result = await importRecording({
      rrweb: values.rrweb,
      title: values.title,
      ...(values.url ? { url: values.url } : {}),
      ...(values.id ? { id: values.id } : {}),
      ...(lists.tag ? { tags: lists.tag } : {}),
      ...(profile ? { profile } : {}),
      ...(lists.person ? { person: lists.person } : {}),
      ...(values.output ? { output: values.output } : {}),
      ...(values['upload-url'] ? { uploadUrl: values['upload-url'] } : {}),
      ...(values['header-file'] ? { headerFile: values['header-file'] } : {}),
      ...(booleans.has('upload') ? { upload: true } : {}),
      ...(booleans.has('login') ? { login: true } : {}),
      ...(values.server ? { serverName: values.server } : {}),
    });
    process.stdout.write(`${JSON.stringify({ success: true, ...result })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode =
      typeof error === 'object' && error !== null && 'exitCode' in error && typeof error.exitCode === 'number' ? error.exitCode : 1;
  }
}

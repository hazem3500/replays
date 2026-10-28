import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { mergeRedactionRules } from '../shared/redaction.ts';
import { compareStores, type MigrateTranslate, migrateStore, type StoreComparison } from './migrate.ts';
import { chooseStorage, resolveSettings } from './runtime.ts';
import { ReplayStore } from './store.ts';
import { summaryFieldsRunner } from './summary-fields.ts';
import { FsStorage, storageFromEnv } from './storage/index.ts';
import type { ObjectStorage } from './storage/types.ts';

export const MIGRATE_USAGE = `replays migrate: copy a store into another, converting every replay on the way

  replays migrate --from <store> --to <store> [--translate ./translate.mjs] [--config path]
                  [--dry-run] [--report out.json] [--concurrency 4]
  replays migrate --compare --from <store> --to <store>

Stores:
  fs:<dir>              a data directory (DATA_DIR layout)
  s3:<bucket>[/prefix]  an S3-compatible bucket (S3_REGION, S3_ENDPOINT, S3_FORCE_PATH_STYLE, AWS_* from the environment)
  <id>                  a storage backend a plugin of the config registers (for example gcs), configured by the environment;
                        fs and s3 alone mean the built-in drivers as STORAGE would configure them

--translate   a module whose default export is (rawReplayJson, info) => rawReplayJson; a named export translateSuite
              converts _suites/<id>.json the same way
--config      the config file (default: REPLAYS_CONFIG, else replays.config.* here): its plugins provide storage backends,
              its context schema checks context.fields
--dry-run     read, translate and validate everything, write nothing
--report      write the JSON report (converted, unchanged, failed with reasons) to this file
--compare     print the list-summary diff between the two stores (GET /api/replays, retention fields left out)

Writes are create-only: nothing the target holds is overwritten, and running it again converts nothing twice.
Exit code 1 when anything failed.`;

export interface MigrateArgs {
  from: string;
  to: string;
  translate?: string;
  config?: string;
  dryRun: boolean;
  report?: string;
  compare: boolean;
  concurrency: number;
}

export function parseMigrateArgs(argv: readonly string[]): MigrateArgs {
  const args: Partial<MigrateArgs> & { dryRun: boolean; compare: boolean; concurrency: number } = {
    dryRun: false,
    compare: false,
    concurrency: 4,
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]!;
    const value = () => {
      const next = argv[++index];
      if (next === undefined || next.startsWith('--')) throw new Error(`${flag} needs a value`);
      return next;
    };
    if (flag === '--from') args.from = value();
    else if (flag === '--to') args.to = value();
    else if (flag === '--translate') args.translate = value();
    else if (flag === '--config') args.config = value();
    else if (flag === '--report') args.report = value();
    else if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--compare') args.compare = true;
    else if (flag === '--concurrency') {
      const count = Number(value());
      if (!Number.isInteger(count) || count < 1 || count > 64) throw new Error('--concurrency must be 1-64');
      args.concurrency = count;
    } else throw new Error(`unknown option ${flag}`);
  }
  if (!args.from || !args.to) throw new Error('--from and --to are required');
  return args as MigrateArgs;
}

/** Imports the translate module: its default export, and `translateSuite` if it has one. */
export async function loadTranslator(path: string, cwd = process.cwd()) {
  const loaded = (await import(pathToFileURL(resolve(cwd, path)).href)) as { default?: unknown; translateSuite?: unknown };
  if (typeof loaded.default !== 'function') throw new Error(`${path} must default-export a function (raw, info) => raw`);
  if (loaded.translateSuite !== undefined && typeof loaded.translateSuite !== 'function')
    throw new Error(`${path}: translateSuite must be a function`);
  return {
    translate: loaded.default as MigrateTranslate,
    ...(loaded.translateSuite ? { translateSuite: loaded.translateSuite as MigrateTranslate } : {}),
  };
}

/** The store a `--from` / `--to` value names. */
export async function openStore(
  spec: string,
  context: { env: NodeJS.ProcessEnv; cwd: string; resolveBackend(id: string, dataDir: string): Promise<ObjectStorage> },
): Promise<ObjectStorage> {
  const { env, cwd } = context;
  const dataDir = resolve(cwd, env.DATA_DIR ?? '.data/replays');
  const colon = spec.indexOf(':');
  const scheme = colon > 0 ? spec.slice(0, colon) : spec;
  const rest = colon > 0 ? spec.slice(colon + 1) : '';
  if (scheme === 'fs' && rest) return new FsStorage(resolve(cwd, rest));
  if (scheme === 's3' && rest) {
    const [bucket, ...prefix] = rest.replace(/^\/+/, '').split('/');
    if (!bucket) throw new Error(`${spec}: no bucket`);
    const { S3_PREFIX: _prefix, ...base } = env;
    return storageFromEnv(
      { ...base, STORAGE: 's3', S3_BUCKET: bucket, ...(prefix.join('/') ? { S3_PREFIX: prefix.join('/') } : {}) },
      dataDir,
    );
  }
  if (colon > 0) throw new Error(`unknown store ${JSON.stringify(spec)}: use fs:<dir>, s3:<bucket>[/prefix] or a storage backend id`);
  return context.resolveBackend(spec.trim().toLowerCase(), dataDir);
}

const show = (value: unknown) => (value === undefined ? '(none)' : JSON.stringify(value).slice(0, 160));

export function formatComparison(comparison: StoreComparison) {
  const lines: string[] = [];
  for (const { id, fields } of comparison.changed)
    lines.push(`~ ${id}`, ...fields.map(({ field, from, to }) => `    ${field}: ${show(from)} -> ${show(to)}`));
  for (const id of comparison.onlyInSource) lines.push(`- ${id} (only in the source)`);
  for (const id of comparison.onlyInTarget) lines.push(`+ ${id} (only in the target)`);
  lines.push(
    `${comparison.identical} identical, ${comparison.changed.length} changed, ${comparison.onlyInSource.length} only in the source, ${comparison.onlyInTarget.length} only in the target`,
  );
  return lines.join('\n');
}

export async function runMigrateCli(argv: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${MIGRATE_USAGE}\n`);
    return;
  }
  let args: MigrateArgs;
  try {
    args = parseMigrateArgs(argv);
  } catch (error) {
    process.stderr.write(`replays migrate: ${error instanceof Error ? error.message : String(error)}\n\n${MIGRATE_USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const cwd = options.cwd ?? process.cwd();
  const env = { ...(options.env ?? process.env), ...(args.config ? { REPLAYS_CONFIG: resolve(cwd, args.config) } : {}) };
  try {
    const { config, settings, registry } = await resolveSettings({ env, cwd });
    // A backend id goes through the same choice as STORAGE: a plugin's backend, else the built-in driver.
    const resolveBackend = (id: string, dataDir: string) => chooseStorage({ ...env, STORAGE: id }, config.file, registry, dataDir);
    const [from, to] = await Promise.all([
      openStore(args.from, { env, cwd, resolveBackend }),
      openStore(args.to, { env, cwd, resolveBackend }),
    ]);
    if (args.compare) {
      const summaryFields = summaryFieldsRunner(registry.summaryFields);
      const store = (storage: ObjectStorage) =>
        new ReplayStore(storage, cwd, settings.retention, { profiles: settings.profiles, ...(summaryFields ? { summaryFields } : {}) });
      const comparison = await compareStores({ from: store(from), to: store(to) });
      process.stdout.write(`${formatComparison(comparison)}\n`);
      if (args.report) await writeFile(resolve(cwd, args.report), `${JSON.stringify(comparison, null, 2)}\n`);
      return;
    }
    const contextSchema = settings.contextSchema;
    const profiles = settings.profiles.ids;
    const translator = args.translate ? await loadTranslator(args.translate, cwd) : {};
    process.stderr.write(`${args.dryRun ? 'dry run: ' : ''}${from.description} -> ${to.description}\n`);
    const report = await migrateStore({
      from,
      to,
      ...translator,
      ...(contextSchema ? { contextSchema } : {}),
      profiles,
      redaction: mergeRedactionRules(settings.redaction, registry.redaction),
      dryRun: args.dryRun,
      concurrency: args.concurrency,
      onProgress({ id, kind, status, done, total }) {
        if (status !== 'unchanged') process.stderr.write(`[${done}/${total}] ${status} ${kind} ${id}\n`);
      },
    });
    for (const failure of report.failed) process.stderr.write(`failed ${failure.kind} ${failure.id}: ${failure.reason}\n`);
    process.stdout.write(
      `${report.dryRun ? 'would convert' : 'converted'} ${report.converted.length}, unchanged ${report.unchanged.length}, failed ${report.failed.length}\n`,
    );
    if (args.report) await writeFile(resolve(cwd, args.report), `${JSON.stringify(report, null, 2)}\n`);
    if (report.failed.length) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`replays migrate: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { LoadedConfig } from '../config/index.ts';
import type { ReplaysPlugin } from '../plugin/types.ts';
import { normalizeBasePath } from './base-path.ts';
import { renderIndexHtml } from './index-page.ts';
import { findPackageRoot } from './package-root.ts';
import { resolveSettings } from './runtime.ts';

/*
 * `replays build-static --out dir`: the built viewer (dist/client) as plain files for a CDN or bucket, with index.html
 * stamped the way the server stamps it per request (index-page.ts): base path, product name, logo, theme tokens and
 * theme-color, beta flags, comments and plugin entries. The API stays on the server, at the same base on the same
 * origin: the CDN sends `<base>/api/*` and `<base>/_plugins/*` there (docs/operations.md "Static viewer on a CDN").
 */

export interface BuildStaticOptions {
  /** Where the files go (created; files already there with the same names are overwritten). */
  out: string;
  /** The public base (`/`, `/replays`); default: the configured `basePath` (`BASE_PATH`). */
  base?: string;
  env?: NodeJS.ProcessEnv;
  /** Where `replays.config.*` is looked for and relative paths resolve from. Default: the working directory. */
  cwd?: string;
  /** Use this config instead of looking one up (`--config` sets `REPLAYS_CONFIG`). */
  config?: LoadedConfig;
  /** Plugins in addition to the config's (their branding and browser entries count). */
  plugins?: readonly ReplaysPlugin[];
  /** The built viewer to copy. Default: the package's `dist/client`. */
  clientDir?: string;
  /** Also copy render.html (the server-side video render's page); it is useless without the server, so off by default. */
  includeRender?: boolean;
}

export interface StaticBuild {
  out: string;
  base: string;
  /** Files written, relative to `out` (sorted; the stamped index.html last). */
  files: string[];
}

async function isFile(path: string) {
  return stat(path).then(
    (info) => info.isFile(),
    () => false,
  );
}

/** Copies the built viewer to `out` and writes the stamped index.html there. */
export async function buildStatic(options: BuildStaticOptions): Promise<StaticBuild> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const clientDir = resolve(options.clientDir ?? resolve(findPackageRoot(), 'dist/client'));
  const out = resolve(cwd, options.out);
  const inside = relative(clientDir, out);
  if (!inside || (!inside.startsWith('..') && !isAbsolute(inside)))
    throw new Error(`--out must be outside the built viewer (${clientDir})`);
  const template = resolve(clientDir, 'index.html');
  if (!(await isFile(template))) throw new Error(`no built viewer at ${clientDir} (run \`pnpm build\` first)`);

  const { settings, registry } = await resolveSettings({
    env,
    cwd,
    ...(options.config ? { config: options.config } : {}),
    ...(options.plugins ? { plugins: options.plugins } : {}),
  });
  const base = options.base === undefined ? settings.basePath : normalizeBasePath(options.base);

  const skip = (path: string) => path === 'index.html' || (path === 'render.html' && !options.includeRender);
  const files = (await readdir(clientDir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(clientDir, resolve(entry.parentPath, entry.name)))
    .filter((path) => !skip(path))
    .sort();
  await mkdir(out, { recursive: true });
  await cp(clientDir, out, { recursive: true, force: true, filter: (source) => !skip(relative(clientDir, source)) });
  // A render.html left over from an earlier build with --include-render goes too: the output matches the options.
  if (!options.includeRender) await rm(resolve(out, 'render.html'), { force: true });

  const html = renderIndexHtml(await readFile(template, 'utf8'), {
    base,
    branding: settings.branding,
    ...(settings.signIn ? { signIn: settings.signIn } : {}),
    beta: settings.beta,
    profiles: settings.profiles.list,
    sources: settings.sources.describe(),
    editing: settings.editing,
    comments: settings.comments.enabled,
    clientEntries: registry.clientEntries,
  });
  await writeFile(resolve(out, 'index.html'), html);
  files.push('index.html');
  return { out, base, files };
}

const USAGE = 'usage: replays build-static --out <dir> [--base /] [--config replays.config.ts] [--include-render]';

/** `replays build-static --out <dir> [--base /] [--config path] [--include-render]` */
export async function runBuildStaticCli(argv: string[]) {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        out: { type: 'string' },
        base: { type: 'string' },
        config: { type: 'string' },
        'include-render': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
    });
    if (values.help) {
      process.stdout.write(`${USAGE}\n`);
      return;
    }
    if (!values.out) throw new Error(`--out is required\n${USAGE}`);
    const env = values.config ? { ...process.env, REPLAYS_CONFIG: values.config } : process.env;
    const built = await buildStatic({
      out: values.out,
      env,
      ...(values.base !== undefined ? { base: values.base } : {}),
      ...(values['include-render'] ? { includeRender: true } : {}),
    });
    process.stdout.write(`built the static viewer in ${built.out} (base ${built.base || '/'}, ${built.files.length} files)\n`);
  } catch (error) {
    process.stderr.write(`build-static: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

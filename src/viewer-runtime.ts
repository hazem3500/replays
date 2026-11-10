import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { createTerminal, type TerminalStream } from './capture/terminal.ts';
import { PRODUCT_SLUG } from './shared/brand.ts';

/** Package directories the server runs from; they are copied beside the installed dependencies. */
const APP_PATHS = ['package.json', 'bin', 'dist/cli', 'dist/lib', 'dist/client', 'dist/start', 'sample'];

export interface ViewerRuntimeOptions {
  /** The installed package (or checkout) that holds `dist/lib/server.mjs`. */
  packageRoot: string;
  env: NodeJS.ProcessEnv;
  stream?: TerminalStream;
  /** Installs `dependencies` into `directory`; defaults to `npm install`. Injectable for tests. */
  install?: (directory: string, dependencies: Record<string, string>) => Promise<void>;
}

interface Manifest {
  version?: string;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const stringMap = (value: unknown) =>
  isRecord(value)
    ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : {};

function parseManifest(text: string): Manifest {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error('package.json is not an object');
  return {
    ...(typeof parsed.version === 'string' ? { version: parsed.version } : {}),
    peerDependencies: stringMap(parsed.peerDependencies),
    devDependencies: stringMap(parsed.devDependencies),
  };
}

/** The server and viewer dependencies: the package's peer dependencies, pinned to the versions it is tested with. */
export function viewerDependencies(manifest: Manifest) {
  const result: Record<string, string> = {};
  for (const [name, range] of Object.entries(manifest.peerDependencies ?? {}).sort(([a], [b]) => a.localeCompare(b)))
    result[name] = manifest.devDependencies?.[name] ?? range;
  return result;
}

export function cacheRoot(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform) {
  const override = env.REPLAYS_VIEWER_CACHE;
  if (override !== undefined && override !== '') return resolve(override);
  const local = env.LOCALAPPDATA;
  if (platform === 'win32' && local !== undefined && local !== '') return join(local, PRODUCT_SLUG);
  const xdg = env.XDG_CACHE_HOME;
  return join(xdg !== undefined && xdg !== '' ? xdg : join(homedir(), '.cache'), PRODUCT_SLUG);
}

/** Whether `name` resolves from `directory` the way Node would find it, walking up through `node_modules` folders. */
export function isInstalled(name: string, directory: string) {
  for (let dir = directory; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules', name, 'package.json'))) return true;
    if (dirname(dir) === dir) return false;
  }
}

function npmInstall(directory: string) {
  return new Promise<void>((done, fail) => {
    const windows = process.platform === 'win32';
    const child = spawn(
      windows ? 'npm.cmd' : 'npm',
      ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error'],
      { cwd: directory, stdio: ['ignore', 'ignore', 'pipe'], shell: windows },
    );
    let errors = '';
    child.stderr.on('data', (chunk: Buffer) => {
      errors = `${errors}${chunk}`.slice(-4000);
    });
    child.on('error', (error) => fail(new Error(`could not run npm: ${error.message}`)));
    child.on('close', (code) => (code === 0 ? done() : fail(new Error(`npm install exited with ${String(code)}\n${errors.trim()}`))));
  });
}

/**
 * The directory to run the server and the server-side commands from. The package itself when the viewer's dependencies are
 * installed beside it (a full install or a checkout); otherwise a copy of it next to a one-time install of those
 * dependencies in the user cache, so `npm install` of the CLI stays small and `serve` pays for the viewer once.
 */
export async function prepareViewerRuntime(options: ViewerRuntimeOptions) {
  const { packageRoot, env, stream = process.stderr } = options;
  const manifest = parseManifest(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const dependencies = viewerDependencies(manifest);
  if (Object.keys(dependencies).every((name) => isInstalled(name, packageRoot))) return packageRoot;

  const server = join(packageRoot, 'dist/lib/server.mjs');
  const key = createHash('sha256')
    .update(JSON.stringify([manifest.version, dependencies, existsSync(server) ? statSync(server).size : 0]))
    .digest('hex')
    .slice(0, 8);
  const directory = join(cacheRoot(env), `viewer-${manifest.version ?? 'dev'}-${key}`);
  const app = join(directory, 'app');
  if (existsSync(join(directory, '.ready'))) return app;

  const terminal = createTerminal({ env, stream });
  const spinner = terminal.spinner('Setting up the viewer (first run only)');
  if (!terminal.fancy) stream.write('Setting up the viewer (first run only)...\n');
  const staging = `${directory}.partial-${process.pid}`;
  try {
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    await writeFile(
      join(staging, 'package.json'),
      `${JSON.stringify({ name: `${PRODUCT_SLUG}-viewer-runtime`, private: true, dependencies }, null, 2)}\n`,
    );
    await (options.install ?? npmInstall)(staging, dependencies);
    for (const path of APP_PATHS) {
      const from = join(packageRoot, path);
      if (existsSync(from)) await cp(from, join(staging, 'app', path), { recursive: true });
    }
    await writeFile(join(staging, '.ready'), `${key}\n`);
    // invariant: a concurrent run that finished first built the same directory, so keep its copy.
    if (existsSync(join(directory, '.ready'))) await rm(staging, { recursive: true, force: true });
    else {
      await rm(directory, { recursive: true, force: true });
      await rename(staging, directory);
    }
  } catch (error) {
    spinner.fail('Could not set up the viewer');
    await rm(staging, { recursive: true, force: true });
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not install the viewer's dependencies into ${directory}.\n${reason}\nCheck the network and npm registry access, then run the command again.`,
      { cause: error },
    );
  }
  spinner.succeed(`Viewer ready ${terminal.dim(`(${directory})`)}`);
  return app;
}

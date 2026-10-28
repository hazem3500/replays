import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertCapturePacing } from '../shared/capture-pacing.ts';
import type { ProfileConfig, ProfileViewerDefaults } from '../shared/profiles.ts';
import { assertPlugin } from '../plugin/define.ts';
import { PluginError } from '../plugin/errors.ts';
import type { PluginSpec, ReplaysPlugin } from '../plugin/types.ts';
import { CONFIG_KEYS, type FileConfig, readConfigFile } from '../server/config.ts';

/**
 * The deployment config: the documented non-secret settings, plus the plugins to load. Identical in a
 * `replays.config.ts|js|json`; only a script can hold plugin objects directly (JSON lists module specifiers).
 */
export type ReplaysConfig = FileConfig;
export type { CapturePacingOptions } from '../shared/capture-pacing.ts';
export type { PluginSpec } from '../plugin/types.ts';
/** The `malleable` block: the host's policy for sandboxed user plugins (docs/malleability.md#the-hosts-policy). */
export type { CapabilityRule, MalleableConfig } from '../shared/malleable-policy.ts';
export type { PosterMoment, ProfileConfig, ProfileViewerDefaults } from '../shared/profiles.ts';

/** @deprecated Use `ProfileConfig`. */
export type PurposeConfig = ProfileConfig;
/** @deprecated Use `ProfileViewerDefaults`. */
export type PurposeViewerDefaults = ProfileViewerDefaults;

/** Typed identity function for `replays.config.ts`: `export default defineConfig({ name: 'Acme', plugins: [acme()] })`. */
export function defineConfig(config: ReplaysConfig): ReplaysConfig {
  return config;
}

/** Looked up in the working directory, in this order, when `REPLAYS_CONFIG` is not set. */
export const CONFIG_FILES = ['replays.config.ts', 'replays.config.mjs', 'replays.config.js', 'replays.config.json'] as const;

export interface LoadedConfig {
  /** The file the config came from, if any. */
  path?: string;
  /** Relative paths inside the config (`contextSchemaFile`, plugin specifiers) are relative to this. */
  dir: string;
  file: FileConfig;
  /** The config's `plugins`, imported and validated. */
  plugins: ReplaysPlugin[];
}

async function exists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function importModule(target: string, label: string): Promise<Record<string, unknown>> {
  try {
    return (await import(target)) as Record<string, unknown>;
  } catch (error) {
    const hint =
      target.endsWith('.ts') &&
      error instanceof Error &&
      /Unknown file extension|ERR_UNSUPPORTED/.test(`${error.name} ${error.message} ${(error as { code?: string }).code}`)
        ? ' (a .ts file needs Node 22.18+ or --experimental-strip-types; or use .mjs)'
        : '';
    throw new PluginError('load-failed', `cannot load ${label}: ${error instanceof Error ? error.message : String(error)}${hint}`, {
      cause: error,
    });
  }
}

async function loadScript(path: string) {
  const loaded = await importModule(pathToFileURL(path).href, `config ${path}`);
  const config = loaded.default;
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error(`${path} must default-export a config object (export default defineConfig({ … }))`);
  const unknown = Object.keys(config).filter((key) => !CONFIG_KEYS.has(key));
  if (unknown.length) throw new Error(`the config file has unknown keys: ${unknown.join(', ')}`);
  return config as FileConfig;
}

/** The module a `plugins` string names: relative to the config's directory, else resolved from there like a `require`. */
function specifierTarget(specifier: string, dir: string) {
  if (/^\.{1,2}\//.test(specifier) || isAbsolute(specifier)) return pathToFileURL(resolve(dir, specifier)).href;
  try {
    return pathToFileURL(createRequire(resolve(dir, 'replays.config.js')).resolve(specifier)).href;
  } catch {
    return specifier;
  }
}

/** Imports one `plugins` entry: a plugin object, or a module whose default export is a plugin or a factory (given `options`). */
export async function loadPluginSpec(spec: PluginSpec, dir: string, index = 0): Promise<ReplaysPlugin> {
  const where = `plugins[${index}]`;
  if (typeof spec !== 'string' && !Array.isArray(spec)) {
    assertPlugin(spec, where);
    return spec as ReplaysPlugin;
  }
  const [specifier, options] = typeof spec === 'string' ? [spec, undefined] : (spec as readonly [string, unknown]);
  if (typeof specifier !== 'string')
    throw new PluginError('invalid-plugin', `${where} must be a plugin, a module specifier or [specifier, options]`);
  const loaded = await importModule(specifierTarget(specifier, dir), `${where} ${specifier}`);
  // A CommonJS package arrives as `default: module.exports`, which may itself be `{ default }` (transpiled ESM).
  let exported = loaded.default;
  if (exported && typeof exported === 'object' && !('setup' in exported) && 'default' in exported)
    exported = (exported as { default: unknown }).default;
  const plugin = typeof exported === 'function' ? await (exported as (options: unknown) => unknown)(options) : exported;
  assertPlugin(plugin, `${where} (${specifier})`);
  return plugin as ReplaysPlugin;
}

/**
 * Finds and reads the config: `REPLAYS_CONFIG`, else the first `replays.config.*` in `cwd`, else nothing (all
 * defaults). Environment variables still win over the file for every setting that has one.
 */
export async function loadConfig(options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): Promise<LoadedConfig> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const explicit = env.REPLAYS_CONFIG?.trim();
  let path = explicit ? resolve(cwd, explicit) : undefined;
  for (const name of path ? [] : CONFIG_FILES) {
    if (await exists(resolve(cwd, name))) {
      path = resolve(cwd, name);
      break;
    }
  }
  if (!path) return { dir: cwd, file: {}, plugins: [] };
  const dir = dirname(path);
  let file: FileConfig;
  if (path.endsWith('.json')) file = await readConfigFile(path);
  else {
    if (!(await exists(path))) throw new Error(`cannot read REPLAYS_CONFIG ${path}: no such file`);
    file = await loadScript(path);
  }
  if (file.capture !== undefined) assertCapturePacing(file.capture);
  if (file.contextSchemaFile) file = { ...file, contextSchemaFile: resolve(dir, file.contextSchemaFile) };
  const specs = file.plugins ?? [];
  if (!Array.isArray(specs)) throw new Error("the config file's plugins must be an array");
  const plugins: ReplaysPlugin[] = [];
  for (const [index, spec] of specs.entries()) plugins.push(await loadPluginSpec(spec, dir, index));
  return { path, dir, file, plugins };
}

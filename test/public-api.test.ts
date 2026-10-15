import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// The public API of the package, entry by entry (docs/api-stability.md). Adding an export is a minor change, removing or
// renaming one is a major change: either way this file changes in the same commit, so the diff shows the API change.

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as {
  exports: Record<string, string | { types: string; default: string }>;
  files: string[];
};

const entries: Record<string, { source: string; values: string[] }> = {
  './plugin': {
    source: '../src/plugin/index.ts',
    values: ['PLUGIN_API_VERSION', 'PluginError', 'assertPlugin', 'definePlugin', 'orderPlugins', 'rejectUpload', 'resolvePlugins'],
  },
  './config': { source: '../src/config/index.ts', values: ['CONFIG_FILES', 'defineConfig', 'loadConfig', 'loadPluginSpec'] },
  './viewer': { source: '../src/client/plugins/api.ts', values: ['defineViewerPlugin'] },
  './server': {
    source: '../src/server/index.ts',
    values: [
      'FsStorage',
      'MemoryStorage',
      'ReplayStore',
      'S3Storage',
      'THEME_TOKENS',
      'authFromEnv',
      'compileContextSchema',
      'createApp',
      'createRuntime',
      'headerAuth',
      'loadSettings',
      'mergeContextSchemas',
      'noneAuth',
      'oidcAuth',
      'readConfigFile',
      'startServer',
      'storageFromEnv',
      'validateBranding',
    ],
  },
  './capture': {
    source: '../src/capture/index.ts',
    values: [
      'PRODUCT_NAME',
      'PRODUCT_SLUG',
      'RecorderSession',
      'SourceProviders',
      'agentBrowserDriver',
      'assertReplayBundle',
      'assertReplayContext',
      'buildHumanBundle',
      'buildReplayContext',
      'capture',
      'githubProvider',
      'gitlabProvider',
      'networkEntries',
      'normalizeConsole',
      'normalizePerformance',
      'parseArgs',
      'playwrightDriver',
      'recorderSource',
      'sanitizeHar',
      'sanitizeReplayBundle',
      'sanitizeUrl',
      'summarizeReplay',
      'templateProvider',
      'urlProvider',
    ],
  },
};

describe('public API', () => {
  it.each(Object.entries(entries))('%s exports exactly the documented values', async (_subpath, { source, values }) => {
    const module = (await import(source)) as Record<string, unknown>;
    expect(Object.keys(module).sort()).toEqual([...values].sort());
  });

  it('the root entry still exports what it did before the subpath entries existed', async () => {
    const module = (await import('../src/index.ts')) as Record<string, unknown>;
    for (const name of [
      'capture',
      'RecorderSession',
      'SourceProviders',
      'headerAuth',
      'noneAuth',
      'oidcAuth',
      'FsStorage',
      'S3Storage',
      'compileContextSchema',
      'THEME_TOKENS',
    ])
      expect(module).toHaveProperty(name);
  });

  it('package.json exposes exactly the documented subpaths, each with types and an ES module', () => {
    expect(Object.keys(pkg.exports)).toEqual(['.', './capture', './server', './viewer', './plugin', './config', './package.json']);
    for (const target of Object.values(pkg.exports)) {
      if (typeof target === 'string') continue;
      expect(target.default).toMatch(/^\.\/dist\/lib\/[a-z]+\.mjs$/);
      expect(target.types).toMatch(/^\.\/dist\/types\/.+\.d\.ts$/);
    }
  });

  it('ships what a custom distribution needs at run time: the built viewer, the samples and the docs it links to', () => {
    for (const path of ['dist/lib', 'dist/types', 'dist/client', 'sample', 'bin']) expect(pkg.files).toContain(path);
  });

  it('keeps the viewer entry free of Node and React, so a browser bundle can import it', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/client/plugins/api.ts'), 'utf8');
    expect(source).not.toMatch(/from 'node:|from 'react|from "react/);
  });
});

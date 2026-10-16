import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { defineConfig, loadConfig, loadPluginSpec } from '../src/config/index.ts';
import { definePlugin, PluginError } from '../src/plugin/index.ts';

const dir = () => mkdtemp(join(tmpdir(), 'replays-loader-'));
const pluginModule = (name: string) =>
  `export default (options) => ({ name: ${JSON.stringify(name)}, apiVersion: 1, options, setup() {} });\n`;

describe('defineConfig', () => {
  it('returns its argument unchanged (it only types the config)', () => {
    const config = { name: 'Acme', plugins: [] };
    expect(defineConfig(config)).toBe(config);
  });
});

describe('loadConfig', () => {
  it('finds nothing, and returns defaults', async () => {
    const cwd = await dir();
    await expect(loadConfig({ env: {}, cwd })).resolves.toEqual({ dir: cwd, file: {}, plugins: [] });
  });

  it('looks for replays.config.ts, .mjs, .js, .json in that order', async () => {
    const cwd = await dir();
    await writeFile(join(cwd, 'replays.config.json'), JSON.stringify({ name: 'from json' }));
    expect((await loadConfig({ env: {}, cwd })).file.name).toBe('from json');
    await writeFile(join(cwd, 'replays.config.js'), "export default { name: 'from js' };\n");
    expect((await loadConfig({ env: {}, cwd })).file.name).toBe('from js');
    await writeFile(join(cwd, 'replays.config.mjs'), "export default { name: 'from mjs' };\n");
    expect((await loadConfig({ env: {}, cwd })).file.name).toBe('from mjs');
    await writeFile(join(cwd, 'replays.config.ts'), "export default { name: 'from ts' as string };\n");
    const loaded = await loadConfig({ env: {}, cwd });
    expect(loaded.file.name).toBe('from ts');
    expect(loaded.path).toBe(join(cwd, 'replays.config.ts'));
  });

  it('REPLAYS_CONFIG wins over discovery, relative to cwd, and must exist', async () => {
    const cwd = await dir();
    await writeFile(join(cwd, 'replays.config.json'), JSON.stringify({ name: 'discovered' }));
    await writeFile(join(cwd, 'other.json'), JSON.stringify({ name: 'explicit' }));
    expect((await loadConfig({ env: { REPLAYS_CONFIG: 'other.json' }, cwd })).file.name).toBe('explicit');
    await expect(loadConfig({ env: { REPLAYS_CONFIG: 'missing.json' }, cwd })).rejects.toThrow(
      /cannot read REPLAYS_CONFIG .*missing\.json/,
    );
    await expect(loadConfig({ env: { REPLAYS_CONFIG: 'missing.mjs' }, cwd })).rejects.toThrow(/cannot read REPLAYS_CONFIG .*missing\.mjs/);
  });

  it('refuses unknown keys and a script without a default export object', async () => {
    const cwd = await dir();
    await writeFile(join(cwd, 'replays.config.mjs'), "export default { name: 'x', bogus: 1 };\n");
    await expect(loadConfig({ env: {}, cwd })).rejects.toThrow('the config file has unknown keys: bogus');
    const other = await dir();
    await writeFile(join(other, 'replays.config.mjs'), 'export const name = 1;\n');
    await expect(loadConfig({ env: {}, cwd: other })).rejects.toThrow(/must default-export a config object/);
  });

  it('resolves contextSchemaFile against the config’s directory', async () => {
    const cwd = await dir();
    await mkdir(join(cwd, 'conf'));
    await writeFile(join(cwd, 'conf', 'replays.config.json'), JSON.stringify({ contextSchemaFile: './schema.json' }));
    const loaded = await loadConfig({ env: { REPLAYS_CONFIG: 'conf/replays.config.json' }, cwd });
    expect(loaded.file.contextSchemaFile).toBe(join(cwd, 'conf', 'schema.json'));
  });

  it('imports plugins listed as objects, specifiers and [specifier, options]', async () => {
    const cwd = await dir();
    await writeFile(join(cwd, 'one.mjs'), pluginModule('one'));
    await writeFile(join(cwd, 'two.mjs'), pluginModule('two'));
    await writeFile(
      join(cwd, 'replays.config.mjs'),
      `import one from './one.mjs';\nexport default { plugins: [one({ a: 1 }), './two.mjs', ['./two.mjs', { b: 2 }]] };\n`,
    );
    const { plugins } = await loadConfig({ env: {}, cwd });
    expect(plugins.map((p) => p.name)).toEqual(['one', 'two', 'two']);
    expect((plugins[0] as unknown as { options: unknown }).options).toEqual({ a: 1 });
    expect((plugins[2] as unknown as { options: unknown }).options).toEqual({ b: 2 });
  });

  it('lists plugins in a JSON config by specifier', async () => {
    const cwd = await dir();
    await writeFile(join(cwd, 'p.mjs'), pluginModule('from-json'));
    await writeFile(join(cwd, 'replays.config.json'), JSON.stringify({ plugins: [['./p.mjs', { x: 1 }]] }));
    const { plugins } = await loadConfig({ env: {}, cwd });
    expect(plugins.map((p) => p.name)).toEqual(['from-json']);
  });

  it('reports a plugin that cannot be loaded or is malformed, as a PluginError', async () => {
    const cwd = await dir();
    await expect(loadPluginSpec('./missing.mjs', cwd)).rejects.toMatchObject({ code: 'load-failed' });
    await writeFile(join(cwd, 'bad.mjs'), "export default { name: 'Bad Name', apiVersion: 1, setup() {} };\n");
    await expect(loadPluginSpec('./bad.mjs', cwd)).rejects.toMatchObject({ code: 'invalid-plugin' });
    await expect(loadPluginSpec(42 as never, cwd, 3)).rejects.toThrow(/plugins\[3\]/);
    await writeFile(join(cwd, 'old.mjs'), "export default { name: 'old', apiVersion: 99, setup() {} };\n");
    await expect(loadPluginSpec('./old.mjs', cwd)).rejects.toBeInstanceOf(PluginError);
  });

  it('accepts a plugin made by definePlugin directly', async () => {
    const p = definePlugin({ name: 'direct', setup() {} });
    await expect(loadPluginSpec(p, '/')).resolves.toBe(p);
  });

  it('finds an installed package by specifier, from the config’s directory', async () => {
    const cwd = await dir();
    await mkdir(join(cwd, 'node_modules', 'replays-plugin-demo'), { recursive: true });
    await writeFile(
      join(cwd, 'node_modules', 'replays-plugin-demo', 'package.json'),
      JSON.stringify({ name: 'replays-plugin-demo', main: 'index.cjs' }),
    );
    await writeFile(
      join(cwd, 'node_modules', 'replays-plugin-demo', 'index.cjs'),
      "module.exports = { default: { name: 'demo', apiVersion: 1, setup() {} } };\n",
    );
    await expect(loadPluginSpec('replays-plugin-demo', cwd)).resolves.toMatchObject({ name: 'demo' });
    expect(pathToFileURL(cwd).href).toContain('file:');
  });
});

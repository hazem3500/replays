import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { definePlugin, PluginError, type PluginApi } from '../src/plugin/index.ts';
import { createRuntime } from '../src/server/runtime.ts';
import { chooseStorage } from '../src/server/runtime.ts';
import { MemoryStorage } from '../src/server/storage/index.ts';

const plugin = (name: string, setup: (api: PluginApi) => void) => definePlugin({ name, setup });
const configOf = (file: Record<string, unknown>, plugins = [] as ReturnType<typeof plugin>[]) => ({
  dir: process.cwd(),
  file: file as never,
  plugins,
});
const runtime = (file: Record<string, unknown>, plugins: ReturnType<typeof plugin>[] = [], env: NodeJS.ProcessEnv = {}) =>
  createRuntime({ env, config: configOf(file), plugins });

describe('createRuntime: precedence', () => {
  it('uses plugin branding and base path when nothing else says', async () => {
    const { settings } = await runtime({}, [
      plugin('a', (api) => {
        api.branding({ name: 'From plugin', theme: { dark: { accent: '#111' } } });
        api.basePath('/p');
      }),
    ]);
    expect(settings.branding).toMatchObject({ name: 'From plugin', theme: { dark: { accent: '#111' } } });
    expect(settings.basePath).toBe('/p');
  });

  it('lets the config file override a plugin, token by token, and the environment override both', async () => {
    const plugins = [
      plugin('a', (api) => {
        api.branding({ name: 'Plugin', theme: { dark: { accent: '#111', ring: '#222' } } });
        api.basePath('/plugin');
      }),
    ];
    const file = { name: 'File', basePath: '/file', theme: { dark: { accent: '#999' }, light: { accent: '#888' } } };
    const { settings } = await runtime(file, plugins);
    expect(settings.branding.name).toBe('File');
    expect(settings.basePath).toBe('/file');
    expect(settings.branding.theme).toEqual({ dark: { accent: '#999', ring: '#222' }, light: { accent: '#888' } });
    const withEnv = await runtime(file, plugins, { PRODUCT_NAME: 'Env', BASE_PATH: '/env' });
    expect(withEnv.settings.branding.name).toBe('Env');
    expect(withEnv.settings.basePath).toBe('/env');
  });
});

describe('createRuntime: auth selection', () => {
  const sso = (api: PluginApi) => api.auth({ name: 'sso', authenticate: () => ({ id: 'u' }) });
  const other = (api: PluginApi) => api.auth({ name: 'other', authenticate: () => ({ id: 'o' }) });

  it('uses the one adapter a plugin registered when nothing is chosen', async () => {
    expect((await runtime({}, [plugin('a', sso)])).auth.name).toBe('sso');
  });

  it('keeps the built-in default without plugin adapters', async () => {
    expect((await runtime({})).auth.name).toBe('none');
  });

  it('asks to choose when several are registered, and honours AUTH_MODE and the config’s `auth`', async () => {
    const plugins = [plugin('a', sso), plugin('b', other)];
    await expect(runtime({}, plugins)).rejects.toThrow(/several plugins registered an auth adapter \(sso, other\)/);
    expect((await runtime({}, plugins, { AUTH_MODE: 'other' })).auth.name).toBe('other');
    expect((await runtime({ auth: 'sso' }, plugins)).auth.name).toBe('sso');
    expect((await runtime({ auth: 'sso' }, plugins, { AUTH_MODE: 'other' })).auth.name).toBe('other');
  });

  it('lets AUTH_MODE pick a built-in over a registered adapter, and refuses an unknown name', async () => {
    expect((await runtime({}, [plugin('a', sso)], { AUTH_MODE: 'none' })).auth.name).toBe('none');
    await expect(runtime({}, [plugin('a', sso)], { AUTH_MODE: 'nope' })).rejects.toThrow(
      /auth "nope" is neither built in .* nor registered by a plugin \(sso\)/,
    );
  });

  it('builds `{ name, create }` adapters from the environment', async () => {
    const made = plugin('a', (api) =>
      api.auth({ name: 'made', create: (env) => ({ name: `made-${env.TOKEN}`, authenticate: () => undefined }) }),
    );
    expect((await runtime({}, [made], { TOKEN: 'abc' })).auth.name).toBe('made-abc');
  });
});

describe('createRuntime: source providers and context schema', () => {
  it('adds plugin providers next to the built-in ones', async () => {
    const { settings } = await runtime({}, [
      plugin('a', (api) =>
        api.sourceProvider({ id: 'jira', label: 'Jira', resolve: (ref) => ({ url: `https://jira.example.com/${ref}`, label: ref }) }),
      ),
    ]);
    expect(settings.sources.ids).toEqual(['github', 'gitlab', 'url', 'jira']);
    expect(settings.sources.resolve({ provider: 'jira', ref: 'AB-1' }).url).toBe('https://jira.example.com/AB-1');
  });

  it('refuses a provider the config already defines', async () => {
    const file = { sourceProviders: [{ id: 'jira', template: 'https://jira.example.com/{ref}' }] };
    await expect(
      runtime(file, [plugin('a', (api) => api.sourceProvider({ id: 'jira', label: 'J', resolve: () => undefined }))]),
    ).rejects.toThrow(/source provider "jira" is already defined by the config/);
  });

  it('merges adapter schemas into one that validates and drives the Context tab', async () => {
    const { settings } = await runtime({}, [
      plugin('a', (api) =>
        api.contextAdapter({
          name: 'one',
          schema: { type: 'object', properties: { env: { type: 'string', title: 'Env' } }, required: ['env'] },
        }),
      ),
      plugin('b', (api) => api.contextAdapter({ name: 'two', schema: { type: 'object', properties: { region: { enum: ['eu', 'us'] } } } })),
    ]);
    const schema = settings.contextSchema!;
    expect(Object.keys(schema.schema.properties as object)).toEqual(['env', 'region']);
    expect(schema.schema.required).toEqual(['env']);
    expect(schema.validate({ env: 'x', region: 'eu' })).toBeUndefined();
    expect(schema.validate({ env: 'x', region: 'asia' })).toMatch(/context\.fields\.region/);
    expect(schema.validate({})).toMatch(/env/);
  });

  it('extends the schema file, and refuses a field it already defines differently', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'replays-runtime-'));
    const file = join(dir, 'schema.json');
    await writeFile(file, JSON.stringify({ type: 'object', properties: { plan: { type: 'string' } } }));
    const adapter = (properties: Record<string, unknown>) =>
      plugin('a', (api) => api.contextAdapter({ name: 'x', schema: { type: 'object', properties } }));
    const { settings } = await runtime({ contextSchemaFile: file }, [adapter({ env: { type: 'string' } })]);
    expect(Object.keys(settings.contextSchema!.schema.properties as object)).toEqual(['plan', 'env']);
    await expect(runtime({ contextSchemaFile: file }, [adapter({ plan: { type: 'number' } })])).rejects.toBeInstanceOf(PluginError);
    await expect(runtime({ contextSchemaFile: file }, [adapter({ plan: { type: 'number' } })])).rejects.toThrow(
      /context field "plan" is defined by the context schema file and by adapter x/,
    );
    await expect(runtime({ contextSchemaFile: file }, [adapter({ plan: { type: 'string' } })])).resolves.toBeDefined();
  });
});

describe('chooseStorage', () => {
  it('uses a plugin backend selected by STORAGE or the config, else the built-ins', async () => {
    const memory = new MemoryStorage();
    const { registry } = await runtime({}, [
      plugin('a', (api) => api.storage({ id: 'mem', create: ({ dataDir }) => Object.assign(memory, { description: dataDir }) })),
    ]);
    expect(await chooseStorage({ STORAGE: 'mem' }, {}, registry, '/data')).toBe(memory);
    expect(await chooseStorage({}, { storage: 'mem' }, registry, '/data')).toBe(memory);
    expect((await chooseStorage({}, {}, registry, '/data')).kind).toBe('fs');
    await expect(chooseStorage({ STORAGE: 'nope' }, {}, registry, '/data')).rejects.toThrow(/STORAGE must be fs or s3/);
  });
});

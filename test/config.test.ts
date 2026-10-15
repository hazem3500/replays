import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadSettings, readConfigFile } from '../src/server/config.ts';
import { PRODUCT_NAME } from '../src/shared/brand.ts';

async function configFile(content: unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'replays-config-'));
  const file = join(dir, 'config.json');
  await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
  return { dir, file };
}

describe('readConfigFile', () => {
  it('returns an empty config without a path', async () => {
    await expect(readConfigFile(undefined)).resolves.toEqual({});
    await expect(readConfigFile('')).resolves.toEqual({});
  });

  it('reads the documented keys', async () => {
    const config = {
      name: 'Acme Replays',
      logoUrl: 'https://example.com/logo.svg',
      theme: { dark: { accent: '#7aa2ff' } },
      basePath: '/replays',
      retentionDays: 14,
      contextSchemaFile: './context.schema.json',
      githubHost: 'github.example.com',
      gitlabHost: 'gitlab.example.com',
      sourceProviders: [{ id: 'jira', template: 'https://jira.example.com/browse/{ref}' }],
    };
    const { file } = await configFile(config);
    await expect(readConfigFile(file)).resolves.toEqual(config);
  });

  it('refuses unknown keys, naming them', async () => {
    const { file } = await configFile({ name: 'x', productName: 'y', retention: { triage: 3 } });
    await expect(readConfigFile(file)).rejects.toThrow('the config file has unknown keys: productName, retention');
  });

  it('refuses a file that is missing, not JSON, or not an object', async () => {
    const { dir, file } = await configFile('{ nope');
    await expect(readConfigFile(file)).rejects.toThrow(/^cannot read REPLAYS_CONFIG /);
    await expect(readConfigFile(join(dir, 'missing.json'))).rejects.toThrow(/^cannot read REPLAYS_CONFIG .*missing\.json/);
    for (const content of ['[]', '"text"', 'null', '3']) {
      const { file: other } = await configFile(content);
      await expect(readConfigFile(other)).rejects.toThrow('the config file must be a JSON object');
    }
  });
});

describe('loadSettings defaults', () => {
  it('runs with nothing configured', async () => {
    const settings = await loadSettings({});
    expect(settings.branding).toEqual({ name: PRODUCT_NAME });
    expect(settings.basePath).toBe('');
    expect(settings.retention).toEqual({ days: 30 });
    expect(settings.sources.ids).toEqual(['github', 'gitlab', 'url']);
    expect(settings.contextSchema).toBeUndefined();
  });
});

describe('loadSettings precedence', () => {
  it('uses the file when the environment says nothing', async () => {
    const settings = await loadSettings(
      {},
      {
        name: 'From File',
        logoUrl: 'https://example.com/file.svg',
        basePath: '/from-file',
        retentionDays: 7,
        githubHost: 'github.file.example.com',
        sourceProviders: [{ id: 'jira', template: 'https://jira.example.com/browse/{ref}' }],
      },
    );
    expect(settings.branding).toEqual({ name: 'From File', logoUrl: 'https://example.com/file.svg' });
    expect(settings.basePath).toBe('/from-file');
    expect(settings.retention).toEqual({ days: 7 });
    expect(settings.sources.ids).toEqual(['github', 'gitlab', 'url', 'jira']);
    expect(settings.sources.resolve({ provider: 'github', ref: 'o/r#1' }).url).toBe('https://github.file.example.com/o/r/issues/1');
  });

  it('lets the environment beat the file, key by key', async () => {
    const settings = await loadSettings(
      {
        PRODUCT_NAME: 'From Env',
        LOGO_URL: 'https://example.com/env.svg',
        BASE_PATH: '/from-env',
        RETENTION_DAYS: '3',
        GITHUB_HOST: 'github.env.example.com',
        GITLAB_HOST: 'gitlab.env.example.com',
      },
      {
        name: 'From File',
        logoUrl: 'https://example.com/file.svg',
        basePath: '/from-file',
        retentionDays: 90,
        githubHost: 'github.file.example.com',
        gitlabHost: 'gitlab.file.example.com',
      },
    );
    expect(settings.branding).toEqual({ name: 'From Env', logoUrl: 'https://example.com/env.svg' });
    expect(settings.basePath).toBe('/from-env');
    expect(settings.retention).toEqual({ days: 3 });
    expect(settings.sources.resolve({ provider: 'github', ref: 'o/r#1' }).url).toBe('https://github.env.example.com/o/r/issues/1');
    expect(settings.sources.resolve({ provider: 'gitlab', ref: 'g/p#1' }).url).toBe('https://gitlab.env.example.com/g/p/-/issues/1');
  });

  it('treats blank environment values as unset', async () => {
    const settings = await loadSettings(
      { PRODUCT_NAME: '  ', BASE_PATH: '', RETENTION_DAYS: ' ', LOGO_URL: '' },
      { name: 'From File', basePath: '/from-file', retentionDays: 5 },
    );
    expect(settings.branding.name).toBe('From File');
    expect(settings.basePath).toBe('/from-file');
    expect(settings.retention).toEqual({ days: 5 });
    expect(settings.branding.logoUrl).toBeUndefined();
  });

  it('takes the theme from the file only', async () => {
    const settings = await loadSettings({}, { theme: { dark: { accent: '#7aa2ff' }, light: { accent: '#2f55d4' } } });
    expect(settings.branding.theme).toEqual({ dark: { accent: '#7aa2ff' }, light: { accent: '#2f55d4' } });
  });
});

describe('loadSettings: BASE_PATH', () => {
  it('normalises the base path', async () => {
    expect((await loadSettings({ BASE_PATH: '/' })).basePath).toBe('');
    expect((await loadSettings({ BASE_PATH: '/replays/' })).basePath).toBe('/replays');
    expect((await loadSettings({ BASE_PATH: '/tools/replays' })).basePath).toBe('/tools/replays');
    expect((await loadSettings({}, { basePath: '/replays/' })).basePath).toBe('/replays');
  });

  it('refuses a path that is not absolute and plain', async () => {
    for (const bad of ['replays', '/a//b', '/a/../b', '//evil.example', 'https://example.com/x'])
      await expect(loadSettings({ BASE_PATH: bad })).rejects.toThrow(/BASE_PATH must be "\/" or an absolute path/);
    await expect(loadSettings({}, { basePath: 'replays' })).rejects.toThrow(/BASE_PATH/);
  });
});

describe('loadSettings: RETENTION_DAYS', () => {
  it('reads whole days, where 0 means never', async () => {
    expect((await loadSettings({ RETENTION_DAYS: '14' })).retention).toEqual({ days: 14 });
    expect((await loadSettings({ RETENTION_DAYS: '0' })).retention).toEqual({ days: 0 });
    expect((await loadSettings({}, { retentionDays: 0 })).retention).toEqual({ days: 0 });
    // The environment wins even when it asks for the default.
    expect((await loadSettings({ RETENTION_DAYS: '0' }, { retentionDays: 30 })).retention).toEqual({ days: 0 });
  });

  it('refuses anything else, from the environment or the file', async () => {
    for (const bad of ['-1', '1.5', 'soon', '3651'])
      await expect(loadSettings({ RETENTION_DAYS: bad })).rejects.toThrow(/RETENTION_DAYS must be a whole number/);
    await expect(loadSettings({}, { retentionDays: -5 })).rejects.toThrow(/RETENTION_DAYS/);
    await expect(loadSettings({}, { retentionDays: 2.5 })).rejects.toThrow(/RETENTION_DAYS/);
  });
});

describe('loadSettings: branding, hosts and source providers', () => {
  it('validates branding like validateBranding does', async () => {
    await expect(loadSettings({ PRODUCT_NAME: 'x'.repeat(61) })).rejects.toThrow('the product name must be 1-60 characters');
    await expect(loadSettings({ LOGO_URL: 'http://example.com/logo.svg' })).rejects.toThrow('LOGO_URL must be an https URL');
    await expect(loadSettings({}, { theme: { dark: { accent: 'url(https://evil.example/x)' } } })).rejects.toThrow(
      'theme.dark.accent is not a plain CSS value',
    );
  });

  it('refuses malformed provider hosts and templates', async () => {
    await expect(loadSettings({ GITHUB_HOST: 'github.example.com/path' })).rejects.toThrow('invalid host name "github.example.com/path"');
    await expect(loadSettings({}, { gitlabHost: 'bad host' })).rejects.toThrow('invalid host name "bad host"');
    expect((await loadSettings({ GITHUB_HOST: 'github.example.com:8443' })).sources.resolve({ provider: 'github', ref: 'o/r#1' }).url).toBe(
      'https://github.example.com:8443/o/r/issues/1',
    );
    await expect(loadSettings({}, { sourceProviders: [{ id: 'jira', template: 'https://jira.example.com/' }] })).rejects.toThrow(
      /needs \{ref\}/,
    );
  });
});

describe('loadSettings: the context schema', () => {
  const schema = { type: 'object', properties: { feature: { type: 'string', title: 'Feature' } } };

  it('loads CONTEXT_SCHEMA_FILE, resolved against the working directory passed in', async () => {
    const { dir } = await configFile({});
    await writeFile(join(dir, 'context.schema.json'), JSON.stringify(schema));
    const fromEnv = await loadSettings({ CONTEXT_SCHEMA_FILE: './context.schema.json' }, {}, dir);
    expect(fromEnv.contextSchema?.schema).toEqual(schema);
    const fromFile = await loadSettings({}, { contextSchemaFile: 'context.schema.json' }, dir);
    expect(fromFile.contextSchema?.validate({ feature: 'coupons' })).toBeUndefined();
    expect(fromFile.contextSchema?.validate({ feature: 3 })).toBe('context.fields.feature must be string');
  });

  it('lets the environment pick another schema file than the config file', async () => {
    const { dir } = await configFile({});
    await writeFile(join(dir, 'a.json'), JSON.stringify({ type: 'object', title: 'A' }));
    await writeFile(join(dir, 'b.json'), JSON.stringify({ type: 'object', title: 'B' }));
    const settings = await loadSettings({ CONTEXT_SCHEMA_FILE: 'b.json' }, { contextSchemaFile: 'a.json' }, dir);
    expect(settings.contextSchema?.schema.title).toBe('B');
  });

  it('fails at start when the schema file is missing or is not an object schema', async () => {
    const { dir } = await configFile({});
    await expect(loadSettings({ CONTEXT_SCHEMA_FILE: 'missing.json' }, {}, dir)).rejects.toThrow(/^cannot read CONTEXT_SCHEMA_FILE /);
    await writeFile(join(dir, 'list.json'), '[]');
    await expect(loadSettings({ CONTEXT_SCHEMA_FILE: 'list.json' }, {}, dir)).rejects.toThrow('must be a JSON Schema object');
  });
});

describe('the whole path from a config file', () => {
  it('reads the file, then lets the environment override it', async () => {
    const { dir, file } = await configFile({ name: 'Acme Replays', basePath: '/replays', retentionDays: 10 });
    const settings = await loadSettings({ RETENTION_DAYS: '20' }, await readConfigFile(file), dir);
    expect(settings.branding.name).toBe('Acme Replays');
    expect(settings.basePath).toBe('/replays');
    expect(settings.retention).toEqual({ days: 20 });
  });
});

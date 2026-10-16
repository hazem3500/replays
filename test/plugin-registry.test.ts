import { describe, expect, it } from 'vitest';

import {
  definePlugin,
  mergeRegistries,
  orderPlugins,
  PluginError,
  PLUGIN_API_VERSION,
  rejectUpload,
  resolvePlugins,
  resolvePluginsSync,
} from '../src/plugin/index.ts';
import type { PluginApi, ReplaysPlugin } from '../src/plugin/index.ts';

const plugin = (name: string, setup: (api: PluginApi) => void = () => {}, extra: Partial<ReplaysPlugin> = {}) =>
  definePlugin({ name, setup, ...extra });

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as PluginError;
  }
  throw new Error('expected a rejection');
};

describe('definePlugin', () => {
  it('stamps the API version and freezes the plugin', () => {
    const p = definePlugin({ name: 'acme', setup() {} });
    expect(p.apiVersion).toBe(PLUGIN_API_VERSION);
    expect(Object.isFrozen(p)).toBe(true);
  });

  it('turns a function of options into a factory', () => {
    const factory = definePlugin((options: { label: string }) => ({
      name: 'labelled',
      setup(api) {
        api.branding({ name: options.label });
      },
    }));
    expect(factory({ label: 'x' }).name).toBe('labelled');
  });

  it.each([
    ['a name that is not lowercase kebab', { name: 'Acme' }],
    ['a name that starts with a digit', { name: '1acme' }],
    ['a name that is too long', { name: `a${'b'.repeat(40)}` }],
    ['no setup function', { name: 'acme', setup: undefined }],
    ['a non-numeric order', { name: 'acme', order: Number.NaN }],
    ['dependsOn that is not strings', { name: 'acme', dependsOn: [1] }],
  ])('refuses %s', (_label, input) => {
    expect(() => definePlugin({ setup() {}, ...input } as never)).toThrow(PluginError);
  });

  it('refuses a plugin written for another API version, naming both', () => {
    expect(() => definePlugin({ name: 'old', apiVersion: 0, setup() {} })).toThrow(/old: needs plugin API 0, this replays provides 1/);
  });
});

describe('ordering', () => {
  const names = (plugins: ReplaysPlugin[]) => orderPlugins(plugins).map((p) => p.name);

  it('keeps config order, then sorts by `order`', () => {
    expect(names([plugin('b'), plugin('a'), plugin('c')])).toEqual(['b', 'a', 'c']);
    expect(names([plugin('b', undefined, { order: 5 }), plugin('a'), plugin('c', undefined, { order: -1 })])).toEqual(['c', 'a', 'b']);
  });

  it('puts dependencies first even against `order` and config position', () => {
    expect(names([plugin('late', undefined, { dependsOn: ['base'], order: -10 }), plugin('base', undefined, { order: 10 })])).toEqual([
      'base',
      'late',
    ]);
  });

  it('refuses duplicates, missing dependencies and cycles', () => {
    expect(() => orderPlugins([plugin('a'), plugin('a')])).toThrow(/a: is listed twice/);
    expect(() => orderPlugins([plugin('a', undefined, { dependsOn: ['ghost'] })])).toThrow(
      /a: depends on "ghost", which is not in the config/,
    );
    const cycle = () => orderPlugins([plugin('a', undefined, { dependsOn: ['b'] }), plugin('b', undefined, { dependsOn: ['a'] })]);
    expect(cycle).toThrow(/dependency cycle among a, b/);
  });

  it('runs setup in that order and reports it', async () => {
    const calls: string[] = [];
    const registry = await resolvePlugins([
      plugin('second', () => calls.push('second'), { dependsOn: ['first'] }),
      plugin('first', () => calls.push('first')),
    ]);
    expect(calls).toEqual(['first', 'second']);
    expect(registry.order).toEqual(['first', 'second']);
  });
});

describe('registrations', () => {
  it('collects every kind, tagged with the plugin that made it', async () => {
    const adapter = { name: 'a1', authenticate: () => undefined };
    const registry = await resolvePlugins([
      plugin('one', (api) => {
        api.auth(adapter);
        api.contextAdapter({ name: 'ctx', schema: { type: 'object', properties: { env: { type: 'string' } } } });
        api.sourceProvider({ id: 'jira', label: 'Jira', resolve: () => undefined });
        api.storage({
          id: 'gcs',
          create: () => {
            throw new Error('unused');
          },
        });
        api.branding({ name: 'Acme', logoUrl: 'https://example.com/l.svg', theme: { dark: { accent: '#fff' } } });
        api.basePath('/replays/');
        api.onRequest(() => {});
        api.onRequest(() => {}, { phase: 'pre-auth' });
        api.onResponse(() => {});
        api.prepareUpload(() => {});
        api.beforeUpload(() => {});
        api.afterUpload(() => {});
        api.client({ id: 'main', script: '/abs/client.js', style: 'https://cdn.example.com/c.css' });
      }),
    ]);
    expect([...registry.auth.keys()]).toEqual(['a1']);
    expect(registry.auth.get('a1')?.plugin).toBe('one');
    expect(registry.contextAdapters.map((a) => a.value.name)).toEqual(['ctx']);
    expect(registry.sourceProviders.map((p) => p.value.id)).toEqual(['jira']);
    expect([...registry.storage.keys()]).toEqual(['gcs']);
    expect(registry.branding).toEqual({ name: 'Acme', logoUrl: 'https://example.com/l.svg', theme: { dark: { accent: '#fff' } } });
    expect(registry.basePath).toBe('/replays');
    expect(registry.hooks.postAuth).toHaveLength(1);
    expect(registry.hooks.preAuth).toHaveLength(1);
    expect(registry.hooks.response).toHaveLength(1);
    expect(registry.hooks.prepareUpload).toHaveLength(1);
    expect(registry.hooks.beforeUpload).toHaveLength(1);
    expect(registry.hooks.afterUpload).toHaveLength(1);
    expect(registry.clientEntries).toEqual([
      { id: 'main', script: '/abs/client.js', style: 'https://cdn.example.com/c.css', plugin: 'one' },
    ]);
  });

  it('builds an auth adapter from a `{ name, create }` registration', async () => {
    const registry = await resolvePlugins([
      plugin('p', (api) => api.auth({ name: 'made', create: (env) => ({ name: `made-${env.X}`, authenticate: () => undefined }) })),
    ]);
    expect((await registry.auth.get('made')!.value({ X: '1' })).name).toBe('made-1');
  });

  it('runs hooks of earlier plugins first', async () => {
    const registry = await resolvePlugins([
      plugin('a', (api) => api.beforeUpload(() => {})),
      plugin('b', (api) => api.beforeUpload(() => {})),
    ]);
    expect(registry.hooks.beforeUpload.map((h) => h.plugin)).toEqual(['a', 'b']);
  });

  it.each([
    ['auth without authenticate', (api: PluginApi) => api.auth({ name: 'x' } as never), /auth needs an adapter/],
    [
      'auth with a bad name',
      (api: PluginApi) => api.auth({ name: 'Bad Name', authenticate: () => undefined }),
      /auth adapter names look like/,
    ],
    ['a context adapter without a name', (api: PluginApi) => api.contextAdapter({} as never), /needs a name/],
    [
      'a context schema that is not an object schema',
      (api: PluginApi) => api.contextAdapter({ name: 'c', schema: { type: 'string' } as never }),
      /"type": "object"/,
    ],
    [
      'a source provider without resolve',
      (api: PluginApi) => api.sourceProvider({ id: 'jira', label: 'J' } as never),
      /resolve must be a function/,
    ],
    ['a storage backend without create', (api: PluginApi) => api.storage({ id: 'gcs' } as never), /storage.create must be a function/],
    ['branding with an unknown token', (api: PluginApi) => api.branding({ theme: { dark: { nope: '1' } as never } }), /not a theme token/],
    ['branding with a url() token', (api: PluginApi) => api.branding({ theme: { dark: { accent: 'url(x)' } } }), /not a plain CSS value/],
    ['branding with an empty name', (api: PluginApi) => api.branding({ name: ' ' }), /non-empty string/],
    ['a base path with ..', (api: PluginApi) => api.basePath('/a/../b'), /basePath must be/],
    ['a base path without a slash', (api: PluginApi) => api.basePath('replays'), /basePath must be/],
    ['a hook that is not a function', (api: PluginApi) => api.onResponse('x' as never), /onResponse hook must be a function/],
    ['an unknown request phase', (api: PluginApi) => api.onRequest(() => {}, { phase: 'during' as never }), /phase must be/],
    [
      'a client entry with a relative script',
      (api: PluginApi) => api.client({ id: 'main', script: './client.js' }),
      /absolute file path or an https URL/,
    ],
    [
      'a client entry with an http URL',
      (api: PluginApi) => api.client({ id: 'main', script: 'http://x.test/a.js' }),
      /absolute file path or an https URL/,
    ],
    ['a client entry with a bad id', (api: PluginApi) => api.client({ id: 'Main', script: '/a.js' }), /client entry needs an id/],
  ])('refuses %s', async (_label, register, message) => {
    const error = await rejection(resolvePlugins([plugin('p', register)]));
    expect(error).toBeInstanceOf(PluginError);
    expect(error.code).toBe('invalid-registration');
    expect(error.message).toMatch(message);
    expect(error.message).toMatch(/^plugin p: /);
  });

  it('wraps an error thrown by setup, keeping the cause', async () => {
    const cause = new Error('boom');
    const error = await rejection(
      resolvePlugins([
        plugin('p', () => {
          throw cause;
        }),
      ]),
    );
    expect(error.code).toBe('setup-failed');
    expect(error.message).toBe('plugin p: setup failed: boom');
    expect(error.cause).toBe(cause);
  });

  it('supports an async setup', async () => {
    const registry = await resolvePlugins([
      plugin('p', async (api) => {
        await Promise.resolve();
        api.branding({ name: 'Late' });
      }),
    ]);
    expect(registry.branding.name).toBe('Late');
  });
});

describe('conflicts between plugins', () => {
  const conflict = async (...plugins: ReplaysPlugin[]) => {
    const error = await rejection(resolvePlugins(plugins));
    expect(error.code).toBe('conflict');
    return error.message;
  };

  it('names both plugins when an auth adapter name is taken, and refuses the built-in names', async () => {
    const auth = (api: PluginApi) => api.auth({ name: 'sso', authenticate: () => undefined });
    expect(await conflict(plugin('a', auth), plugin('b', auth))).toBe('plugin b: auth adapter "sso" is already registered by a');
    expect(await conflict(plugin('a', (api) => api.auth({ name: 'oidc', authenticate: () => undefined })))).toMatch(/"oidc" is built in/);
  });

  it('refuses a context field defined differently, and accepts an identical definition', async () => {
    const adapter = (name: string, type: string) => (api: PluginApi) =>
      api.contextAdapter({ name, schema: { type: 'object', properties: { env: { type } } } });
    expect(await conflict(plugin('a', adapter('one', 'string')), plugin('b', adapter('two', 'number')))).toMatch(
      /context field "env" is defined differently by a \(one\) and two/,
    );
    await expect(resolvePlugins([plugin('a', adapter('one', 'string')), plugin('b', adapter('two', 'string'))])).resolves.toBeDefined();
    expect(await conflict(plugin('a', adapter('same', 'string')), plugin('b', adapter('same', 'string')))).toMatch(
      /context adapter "same" is already registered by a/,
    );
  });

  it('refuses duplicate and built-in source providers and storage ids', async () => {
    const provider = (api: PluginApi) => api.sourceProvider({ id: 'jira', label: 'J', resolve: () => undefined });
    expect(await conflict(plugin('a', provider), plugin('b', provider))).toMatch(/source provider "jira" is already registered by a/);
    expect(await conflict(plugin('a', (api) => api.sourceProvider({ id: 'github', label: 'G', resolve: () => undefined })))).toMatch(
      /"github" is built in/,
    );
    expect(await conflict(plugin('a', (api) => api.storage({ id: 's3', create: () => undefined as never })))).toMatch(/"s3" is built in/);
    const backend = (api: PluginApi) => api.storage({ id: 'gcs', create: () => undefined as never });
    expect(await conflict(plugin('a', backend), plugin('b', backend))).toMatch(/storage backend "gcs" is already registered by a/);
  });

  it('refuses two plugins that set the same branding field or theme token to different values', async () => {
    expect(
      await conflict(
        plugin('a', (api) => api.branding({ name: 'A' })),
        plugin('b', (api) => api.branding({ name: 'B' })),
      ),
    ).toBe('plugin b: sets branding.name to "B", but a already set "A"');
    const accent = (value: string) => (api: PluginApi) => api.branding({ theme: { light: { accent: value } } });
    expect(await conflict(plugin('a', accent('#111')), plugin('b', accent('#222')))).toMatch(
      /theme.light.accent to "#222", but a already set "#111"/,
    );
  });

  it('merges non-overlapping and identical branding', async () => {
    const registry = await resolvePlugins([
      plugin('a', (api) => api.branding({ name: 'Same', theme: { dark: { accent: '#111' } } })),
      plugin('b', (api) =>
        api.branding({ name: 'Same', logoUrl: 'https://example.com/l.svg', theme: { dark: { ring: '#222' }, light: { accent: '#333' } } }),
      ),
    ]);
    expect(registry.branding).toEqual({
      name: 'Same',
      logoUrl: 'https://example.com/l.svg',
      theme: { dark: { accent: '#111', ring: '#222' }, light: { accent: '#333' } },
    });
  });

  it('refuses two different base paths', async () => {
    expect(
      await conflict(
        plugin('a', (api) => api.basePath('/one')),
        plugin('b', (api) => api.basePath('/two')),
      ),
    ).toMatch(/sets basePath "\/two", but a already set "\/one"/);
  });

  it('refuses the same client entry id twice in one plugin', async () => {
    expect(
      await conflict(
        plugin('a', (api) => {
          api.client({ id: 'main', script: '/a.js' });
          api.client({ id: 'main', script: '/b.js' });
        }),
      ),
    ).toMatch(/registered twice/);
  });
});

describe('rejectUpload', () => {
  it('is an error carrying the HTTP status', () => {
    expect(rejectUpload(422, 'no')).toMatchObject({ message: 'no', status: 422 });
  });
});

describe('resolvePluginsSync and mergeRegistries', () => {
  it('resolves synchronous setups without a promise, and refuses an asynchronous one', () => {
    const registry = resolvePluginsSync([plugin('a', (api) => api.branding({ name: 'Sync' }))]);
    expect(registry.branding.name).toBe('Sync');
    expect(() => resolvePluginsSync([plugin('b', async () => {})])).toThrow(/asynchronous setup cannot be used here/);
    expect(() =>
      resolvePluginsSync([
        plugin('c', () => {
          throw new Error('boom');
        }),
      ]),
    ).toThrow(/plugin c: setup failed: boom/);
  });

  it('merges two registries: the first one’s hooks run first, the second wins branding and base path', async () => {
    const first = resolvePluginsSync([
      plugin('built-in', (api) => {
        api.onRequest(() => {});
        api.branding({ name: 'Built-in' });
        api.basePath('/first');
      }),
    ]);
    const second = await resolvePlugins([
      plugin('user', (api) => {
        api.onRequest(() => {});
        api.branding({ name: 'User' });
        api.basePath('/second');
        api.auth({ name: 'sso', authenticate: () => undefined });
      }),
    ]);
    const merged = mergeRegistries(first, second);
    expect(merged.order).toEqual(['built-in', 'user']);
    expect(merged.hooks.postAuth.map((hook) => hook.plugin)).toEqual(['built-in', 'user']);
    expect(merged.branding.name).toBe('User');
    expect(merged.basePath).toBe('/second');
    expect([...merged.auth.keys()]).toEqual(['sso']);
  });

  it('refuses the same plugin or the same auth adapter on both sides', async () => {
    const a = resolvePluginsSync([plugin('same', (api) => api.auth({ name: 'sso', authenticate: () => undefined }))]);
    expect(() => mergeRegistries(a, a)).toThrow(/same: is listed twice/);
    const b = resolvePluginsSync([plugin('other', (api) => api.auth({ name: 'sso', authenticate: () => undefined }))]);
    expect(() => mergeRegistries(a, b)).toThrow(/auth adapter "sso" is registered twice/);
  });
});

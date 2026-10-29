import { SLOT_NAMES } from '../src/client/plugins/api.ts';
import type { ViewerPluginApi, SlotDescriptor, SlotConfiguration, PluginPageDefinition } from '../src/client/plugins/api.ts';
import type {
  Identity,
  IdentityCapabilities,
  NormalizeUploadHook,
  PluginApi,
  PluginMiddleware,
  PluginRoute,
  PrepareUploadHook,
  RequestPolicy,
  UploadEndpoint,
} from '../src/plugin/index.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, expectTypeOf, it } from 'vitest';

// The public API of the package, entry by entry (docs/api-stability.md). Adding an export is a minor change, removing or
// renaming one is a major change: either way this file changes in the same commit, so the diff shows the API change.

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as {
  exports: Record<string, string | { types: string; default: string }>;
  files: string[];
};

const entries: Record<string, { source: string; values: string[] }> = {
  './recorder': {
    source: '../src/recorder/index.ts',
    values: [
      'BLOCK_ATTRIBUTE',
      'DEFAULT_ALLOWED_HEADERS',
      'DEFAULT_MAX_BYTES',
      'DEFAULT_MAX_DURATION_MS',
      'DEFAULT_MESSAGES',
      'defaultRecorderMessages',
      'resolveRecorderMessages',
      'createRecorderFormat',
      'IssueUploadError',
      'MASK_INPUT_OPTIONS',
      'MAX_BYTES_CEILING',
      'MAX_DURATION_CEILING_MS',
      'UI_ATTRIBUTE',
      'CHAT_WIDGET_PRESETS',
      'blockProps',
      'createHttpUpload',
      'blockSelector',
      'recorderUiProps',
      'createDeferredUi',
      'createRecorderStore',
      'createRecordingTimer',
      'recordingTimer',
      'formatDurationLong',
      'selectView',
      'selectCanRequest',
      'selectSummary',
      'selectReceipt',
      'selectError',
      'selectUploadProgress',
      'buildReplayBundle',
      'createDefaultUi',
      'createRecorder',
      'createTokenUpload',
      'formatDuration',
      'gzip',
      'redactText',
      'redactUrl',
    ],
  },
  './recorder/kit': {
    source: '../src/recorder/kit/index.ts',
    values: [
      'BLOCK_ATTRIBUTE',
      'UI_ATTRIBUTE',
      'CHAT_WIDGET_PRESETS',
      'blockProps',
      'blockSelector',
      'recorderUiProps',
      'createAnnouncer',
      'focusReturn',
      'trapFocus',
      'markRecorderUi',
      'mountRecorderRoot',
    ],
  },
  './recorder/ui': {
    source: '../src/recorder/ui/index.ts',
    values: [
      'createDefaultUi',
      'DEFAULT_MESSAGES',
      'defaultRecorderMessages',
      'resolveRecorderMessages',
      'createRecorderFormat',
      'formatDuration',
      'createGuidedRecorder',
      'composeUi',
      'consentDialog',
      'recordingIndicator',
      'reviewDialog',
      'resultToast',
    ],
  },
  './recorder/react': {
    source: '../src/recorder/react/index.tsx',
    values: [
      'RecorderProvider',
      'RecorderRegion',
      'useRecorder',
      'useRecorderActions',
      'useRecorderState',
      'useRecordingTimer',
      'useRecorderPrompt',
      'useStopAttestation',
      'useAnnouncer',
    ],
  },
  './recorder/testing': {
    source: '../src/recorder/testing/index.ts',
    values: ['testRecorderUi', 'queryDeep', 'createFakeRrweb', 'createFakeTransport'],
  },
  './plugin': {
    source: '../src/plugin/index.ts',
    values: [
      'HttpError',
      'PLUGIN_API_VERSION',
      'PluginError',
      'assertPlugin',
      'assertRedactionRules',
      'definePlugin',
      'mergeRegistries',
      'orderPlugins',
      'rejectUpload',
      'resolvePlugins',
      'resolvePluginsSync',
      'SUMMARY_FIELD_LIMITS',
      'tooManyRequests',
    ],
  },
  './config': { source: '../src/config/index.ts', values: ['CONFIG_FILES', 'defineConfig', 'loadConfig', 'loadPluginSpec'] },
  './viewer': {
    source: '../src/client/plugins/api.ts',
    values: ['MAX_TRACK_MARKERS', 'VIEWER_API_VERSION', 'defineViewerPlugin', 'SLOT_NAMES', 'SlotRegistry', 'ViewerRegistry'],
  },
  './server': {
    source: '../src/server/index.ts',
    values: [
      'FsStorage',
      'MemoryStorage',
      'NotFoundError',
      'ObjectExistsError',
      'PreconditionFailedError',
      'ProfileCatalog',
      'ViewCatalog',
      'PurposeCatalog',
      'ReplayStore',
      'S3Storage',
      'THEME_TOKENS',
      'assertKey',
      'authFromEnv',
      'buildStatic',
      'compareStores',
      'compileContextSchema',
      'createApp',
      'createProfileCatalog',
      'createViewCatalog',
      'createPurposeCatalog',
      'createRuntime',
      'globToRegExp',
      'headerAuth',
      'loadSettings',
      'mergeContextSchemas',
      'migrateStore',
      'noneAuth',
      'normalizeHosts',
      'oidcAuth',
      'readConfigFile',
      'renderIndexHtml',
      'resolveSettings',
      'startServer',
      'storageFromEnv',
      'validateBranding',
      'verifyJwt',
      'withBase',
    ],
  },
  './plugins/iap': {
    source: '../src/first-party/iap.ts',
    values: ['IAP_ISSUER', 'IAP_JWKS_URL', 'default', 'iapAuth', 'resolveIapOptions'],
  },
  './plugins/gcs': {
    source: '../src/first-party/gcs.ts',
    values: ['GcsError', 'GcsStorage', 'RESUMABLE_BYTES', 'default', 'gcsStorageFromEnv'],
  },
  './server/testing': {
    source: '../src/server/testing/index.ts',
    values: ['createTestClient', 'describeAuthAdapter', 'describeObjectStorage', 'fakeRequest'],
  },
  './capture': {
    source: '../src/capture/index.ts',
    values: [
      'PRODUCT_NAME',
      'PRODUCT_SLUG',
      'RecorderSession',
      'SourceProviders',
      'agentBrowserDriver',
      'assertRedactionRules',
      'assertReplayBundle',
      'assertReplayContext',
      'assertReplayPeople',
      'buildHumanBundle',
      'buildReplayContext',
      'capture',
      'githubProvider',
      'gitlabProvider',
      'networkEntries',
      'normalizeConsole',
      'normalizePerformance',
      'normalizeServerUrl',
      'normalizeUploadUrl',
      'parseArgs',
      'parsePeopleFlags',
      'personMatch',
      'playwrightDriver',
      'recorderSource',
      'resolveServerUrl',
      'resolveUploadEndpoint',
      'sanitizeHar',
      'sanitizeReplayBundle',
      'sanitizeUrl',
      'saveServer',
      'summarizeReplay',
      'templateProvider',
      'uploadEndpoint',
      'urlProvider',
    ],
  },
};

describe('public API', () => {
  it('pins the published slot names', () => {
    expect(SLOT_NAMES).toEqual([
      'viewer.inspector.tabs',
      'viewer.panels.side',
      'viewer.actions',
      'viewer.scrubber.tracks',
      'viewer.context.sections',
      'index.row.columns',
      'index.filters',
      'index.sections',
      'settings.sections',
      'index.chips',
      'inspector.network.columns',
      'performance.vitals',
      'editor.topbar.actions',
      'editor.inspector.sections',
      'editor.tools',
      'editor.timeline.lanes',
      'export.formats',
    ]);
  });
  it('publishes the additive slot configuration and descriptor signatures', () => {
    expectTypeOf<ViewerPluginApi['registerPluginPage']>().parameter(0).toEqualTypeOf<PluginPageDefinition>();
    expectTypeOf<ViewerPluginApi['configureSlot']>().parameter(1).toEqualTypeOf<SlotConfiguration>();
    expectTypeOf<SlotDescriptor<{ enabled: boolean }, string>['render']>().toEqualTypeOf<(context: { enabled: boolean }) => string>();
  });
  it('exposes typed host intake registration and the existing prepare hook contract', () => {
    expectTypeOf<PluginApi['requestPolicy']>().parameter(0).toEqualTypeOf<RequestPolicy>();
    expectTypeOf<PluginApi['uploadEndpoint']>().parameter(0).toEqualTypeOf<UploadEndpoint>();
    expectTypeOf<UploadEndpoint['prepare']>().toEqualTypeOf<PrepareUploadHook | undefined>();
    expectTypeOf<UploadEndpoint['normalize']>().toEqualTypeOf<NormalizeUploadHook | undefined>();
    expectTypeOf<PluginApi['normalizeUpload']>().parameter(0).toEqualTypeOf<NormalizeUploadHook>();
    expectTypeOf<Identity['capabilities']>().toEqualTypeOf<IdentityCapabilities | undefined>();
  });
  it('exposes the web-standard route and middleware registrations', () => {
    expectTypeOf<PluginApi['route']>().toBeCallableWith({ method: 'GET', path: '/api/plugins/acme', handler: () => new Response('') });
    expectTypeOf<PluginApi['middleware']>().parameter(0).toEqualTypeOf<PluginMiddleware>();
    expectTypeOf<ReturnType<PluginRoute['handler']>>().toEqualTypeOf<Response | Promise<Response>>();
  });
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
    expect(Object.keys(pkg.exports)).toEqual([
      '.',
      './capture',
      './server',
      './server/testing',
      './viewer',
      './plugin',
      './config',
      './plugins/iap',
      './plugins/gcs',
      './package.json',
      './recorder/kit',
      './recorder/ui',
      './recorder/react',
      './recorder/testing',
      './recorder',
    ]);
    for (const target of Object.values(pkg.exports)) {
      if (typeof target === 'string') continue;
      expect(target.default).toMatch(/^\.\/dist\/lib\/[a-z-]+\.mjs$/);
      expect(target.types).toMatch(/^\.\/dist\/types\/.+\.d\.ts$/);
    }
  });
});

describe('public API distribution compatibility', () => {
  it('ships what a custom distribution needs at run time: the built viewer, the samples and the docs it links to', () => {
    for (const path of ['dist/lib', 'dist/types', 'dist/client', 'sample', 'bin']) expect(pkg.files).toContain(path);
  });

  it('builds first-party plugins only on the public surface (/plugin and /server), as a third party would', () => {
    for (const file of ['iap.ts', 'gcs.ts']) {
      const source = readFileSync(resolve(import.meta.dirname, '../src/first-party', file), 'utf8');
      const imports = [...source.matchAll(/from '(\.\.?\/[^']+)'/g)].map((match) => match[1]);
      for (const path of imports) expect(path, `${file} imports ${path}`).toMatch(/^\.\.\/(plugin|server)\/index\.ts$/);
    }
  });

  it('keeps the testing entry free of any test runner, so it works under vitest, node:test or Jest', () => {
    for (const file of ['index.ts', 'storage.ts', 'auth.ts', 'runner.ts']) {
      const source = readFileSync(resolve(import.meta.dirname, '../src/server/testing', file), 'utf8');
      expect(source).not.toMatch(/^import[^\n]*from '(vitest|jest|mocha|node:test)/m);
    }
  });

  it('keeps the viewer entry free of Node and React, so a browser bundle can import it', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/client/plugins/api.ts'), 'utf8');
    expect(source).not.toMatch(/from 'node:|from 'react|from "react/);
  });
});

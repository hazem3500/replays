import { SLOT_NAMES, ViewerRegistry } from '../src/client/plugins/api.ts';
import type {
  EditorToolDefinition,
  ExportFormatDefinition,
  ShortcutDefinition,
  ViewerEventMap,
  ViewerPluginApi,
  SlotDescriptor,
  SlotConfiguration,
  PluginPageDefinition,
} from '../src/client/plugins/api.ts';
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
import type { RecorderChoices, RecorderOptions, RecorderUi, RecordingChoice, RecordingChoiceOffer } from '../src/recorder/index.ts';
import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';

// The public API of the package, entry by entry (docs/api-stability.md). Adding an export is a minor change, removing or
// renaming one is a major change: either way this file changes in the same commit, so the diff shows the API change.

const entries: Record<string, { source: string; values: string[] }> = {
  './model': {
    source: '../src/shared/model.ts',
    values: [
      'assertReplayBundle',
      'assertReplayId',
      'formatClock',
      'summarizeReplay',
      'assertReplayContext',
      'EDITS_VERSION',
      'EMPTY_EDITS',
      'applyEdits',
      'assertReplayEdits',
      'assertStoredReplayEdits',
      'editTimeline',
      'isEmptyEdits',
      'NO_EFFECTS',
      'playbackEffects',
      'assertRedactionRules',
      'compileRedaction',
      'mergeRedactionRules',
      'redactText',
      'isSecretField',
      'REDACTED',
      'assertCaptureProfile',
    ],
  },
  './viewer/playback': {
    source: '../src/client/playback/index.ts',
    values: ['ReplayController', 'eventSpan', 'SPEEDS', 'createReplayPlayback'],
  },
  './viewer/diagnostics': {
    source: '../src/client/diagnostics.ts',
    values: ['buildNetworkRows', 'buildPerformance', 'buildWaterfall', 'collectErrors'],
  },
  './viewer/react': {
    source: '../src/client/compose/index.ts',
    values: [
      'ReplayProvider',
      'useReplay',
      'useReplayTime',
      'useReplayState',
      'useReplayViewport',
      'ReplayStage',
      'ReplayTransport',
      'ReplaySteps',
      'useReplaySteps',
      'ReplayInspector',
      'useReplayInspector',
    ],
  },
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
      'publicProps',
      'PUBLIC_ATTRIBUTE',
      'createHttpUpload',
      'handoffUpload',
      'HandoffUploadError',
      'DEFAULT_HANDOFF_READY_TIMEOUT_MS',
      'DEFAULT_HANDOFF_UPLOAD_TIMEOUT_MS',
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
  it('exposes typed editor, export and shortcut contributions', () => {
    expectTypeOf<ViewerPluginApi['registerEditorTool']>().parameter(0).toEqualTypeOf<EditorToolDefinition>();
    expectTypeOf<ViewerPluginApi['registerExportFormat']>().parameter(0).toEqualTypeOf<ExportFormatDefinition>();
    expectTypeOf<ViewerPluginApi['registerShortcut']>().parameter(0).toEqualTypeOf<ShortcutDefinition>();
  });

  it('lets a recorder host offer per-recording choices through the UI contract', () => {
    expectTypeOf<RecorderOptions['choices']>().toEqualTypeOf<RecorderChoices | undefined>();
    expectTypeOf<NonNullable<RecorderUi['chooseOptions']>>().returns.resolves.toEqualTypeOf<RecordingChoice | undefined>();
    expectTypeOf<NonNullable<RecorderUi['chooseOptions']>>().parameter(0).toHaveProperty('offer').toEqualTypeOf<RecordingChoiceOffer>();
  });

  it('publishes typed content-free event subscriptions', () => {
    const observeSeek = new ViewerRegistry().apiFor('host').on<'seek'>;
    expectTypeOf(observeSeek).toBeCallableWith('seek', (_event: ViewerEventMap['seek']) => {});
    expectTypeOf<ViewerEventMap['index:filter']>().toEqualTypeOf<{ readonly activeCount: number }>();
  });
  it('pins the additive theme token contract', async () => {
    const { THEME_TOKENS } = await import('../src/server/index.ts');
    const contract: unknown = JSON.parse(readFileSync(new URL('../docs/formats/theme-tokens.json', import.meta.url), 'utf8'));
    expect(contract).toEqual({ version: 2, tokens: THEME_TOKENS });
    expect(THEME_TOKENS).toContain('caption-bg');
    expect(THEME_TOKENS).toContain('motion-fast');
  });
  it('pins the published slot names', () => {
    expect(SLOT_NAMES).toEqual([
      'viewer.inspector.tabs',
      'viewer.panels.side',
      'viewer.actions',
      'viewer.shortcuts',
      'viewer.scrubber.tracks',
      'viewer.context.sections',
      'viewer.headline',
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
});

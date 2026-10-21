import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AuthAdapter, AuthPluginFactory, Identity } from '../server/auth/types.ts';
import type { ThemeTokens } from '../server/branding.ts';
import type { ObjectStorage } from '../server/storage/types.ts';
import type { ReplayContext } from '../shared/context.ts';
import type { RedactionRules } from '../shared/redaction.ts';
import type { ReplayBundle } from '../shared/replay.ts';
import type { SourceProvider } from '../shared/source-providers.ts';

/** The plugin API generation. A plugin declares the one it was written for; a mismatch is refused at start. */
export const PLUGIN_API_VERSION = 1;

/** A JSON Schema object (`type: "object"`) describing some of `context.fields`. */
export interface ContextFieldsSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [keyword: string]: unknown;
}

/** What an adapter is told about the upload (or suite registration) a context belongs to. */
export interface ContextInfo {
  kind: 'replay' | 'suite' | 'run';
  /** The signed-in uploader. */
  identity: Identity;
  /** The raw request, e.g. for proxy headers. Do not read the body. */
  request: IncomingMessage;
}

/**
 * A test-context / metadata adapter: runs on every upload and suite registration, before the context is checked
 * against the deployment's schema. Typical jobs: fill `fields` from the request or the uploader, normalise
 * a producer's vocabulary, derive links.
 */
export interface ContextAdapter {
  readonly name: string;
  /** Schema of the `fields` this adapter owns. Merged into the deployment's schema (it drives validation and the Context tab). */
  readonly schema?: ContextFieldsSchema;
  /** Returns the context to use (the input may be `undefined` when the producer sent none). */
  normalize?(context: ReplayContext | undefined, info: ContextInfo): ReplayContext | undefined | Promise<ReplayContext | undefined>;
}

/** An auth adapter built when the server starts. */
export interface AuthRegistration {
  readonly name: string;
  create: AuthPluginFactory;
}

/** A storage backend, selected with `STORAGE=<id>` (or `storage` in the config). */
export interface StorageBackend {
  /** Not `fs`, `s3` or `memory`; those are built in. */
  readonly id: string;
  create(context: { env: NodeJS.ProcessEnv; dataDir: string }): ObjectStorage | Promise<ObjectStorage>;
}

/** A browser-side entry: an ES module whose default export is a `ViewerPlugin` (see `@hazem3500/replays/viewer`). */
export interface ClientEntry {
  /** Unique within the plugin; part of the served URL. `[a-z0-9-]`. */
  readonly id: string;
  /** An absolute file path (served by the app, behind the same auth) or an `https:` URL. */
  readonly script: string;
  /** Optional stylesheet, same rules. */
  readonly style?: string;
}

export interface BrandingContribution {
  name?: string;
  logoUrl?: string;
  theme?: { dark?: ThemeTokens; light?: ThemeTokens };
}

export interface RequestHookContext {
  request: IncomingMessage;
  response: ServerResponse;
  /** The path without the base path (`/api/replays`). */
  path: string;
  /** Present in the `post-auth` phase (the default). */
  identity?: Identity;
}

/** Return `true` after answering the request yourself; anything else lets it continue. */
export type RequestHook = (context: RequestHookContext) => boolean | void | Promise<boolean | void>;

export interface ResponseHookContext {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  identity?: Identity;
}

export type ResponseHook = (context: ResponseHookContext) => void | Promise<void>;

export interface PrepareUploadContext {
  /** The parsed JSON body of `POST /api/replays`, before any validation. Untrusted; may not even be an object. */
  body: unknown;
  identity: Identity;
  request: IncomingMessage;
}

/**
 * Runs on the raw upload before the core validates anything: translate a producer's older or foreign shape into the
 * current one. Whatever it returns goes through all the usual checks and the privacy pass.
 */
export type PrepareUploadHook = (context: PrepareUploadContext) => unknown | Promise<unknown>;

export interface UploadHookContext {
  bundle: ReplayBundle;
  identity: Identity;
  request: IncomingMessage;
}

/** Runs on the sanitized, validated bundle before it is stored. Throw `rejectUpload(status, message)` to refuse; return a bundle to replace it. */
export type BeforeUploadHook = (context: UploadHookContext) => ReplayBundle | void | Promise<ReplayBundle | void>;

export interface AfterUploadContext extends UploadHookContext {
  /** Public path of the stored replay (base path included). */
  url: string;
}

/** Runs after the bundle is stored. Errors are logged; they never fail the upload. */
export type AfterUploadHook = (context: AfterUploadContext) => void | Promise<void>;

export interface RequestHookOptions {
  /** `post-auth` (default): only authenticated requests arrive, with `identity`. `pre-auth`: every request, before auth. */
  phase?: 'pre-auth' | 'post-auth';
}

/** What `setup` registers against. Every method may be called any number of times, except where noted. */
export interface PluginApi {
  readonly pluginName: string;
  readonly env: NodeJS.ProcessEnv;
  /** Working directory the server was started in. */
  readonly cwd: string;
  /**
   * Register an auth adapter, or `{ name, create(env) }` to build it from the environment. Names are unique across
   * plugins and select the adapter (`AUTH_MODE=<name>` or `auth` in the config); see docs/extension-api.md.
   */
  auth(adapter: AuthAdapter | AuthRegistration): void;
  contextAdapter(adapter: ContextAdapter): void;
  sourceProvider(provider: SourceProvider): void;
  storage(backend: StorageBackend): void;
  /** Name, logo and theme tokens. Two plugins may not set the same field to different values; config and env win over plugins. */
  branding(contribution: BrandingContribution): void;
  /** The default base path (`/replays`). Config and env win. */
  basePath(path: string): void;
  onRequest(hook: RequestHook, options?: RequestHookOptions): void;
  onResponse(hook: ResponseHook): void;
  /** Translate the raw upload body before validation (legacy producers). */
  prepareUpload(hook: PrepareUploadHook): void;
  beforeUpload(hook: BeforeUploadHook): void;
  afterUpload(hook: AfterUploadHook): void;
  /** A browser entry that registers inspector tabs, viewer actions and panels. */
  client(entry: ClientEntry): void;
  /**
   * Redaction rules added to the sanitiser's defaults (never weakening them), in the capture CLI and the server's privacy
   * pass. Rules from several plugins and the config file's `redaction` add up. Trusted config: see docs/extending.md.
   */
  redaction(rules: RedactionRules): void;
}

export interface ReplaysPlugin {
  /** `[a-z][a-z0-9-]{0,39}`; unique. It namespaces ids and the served URLs of the plugin's client entries. */
  readonly name: string;
  /** The plugin API generation the plugin was written for (`PLUGIN_API_VERSION`). */
  readonly apiVersion: number;
  /**
   * The versions of this package the plugin works with, a semver range such as `>=0.4 <0.6` or `^0.4.1` (`>=`, `>`, `<`,
   * `<=`, `=`, `^`, `~`, space-separated terms must all hold). A core outside it refuses the plugin at start
   * (`PluginError` `version-range`). Use it when the plugin needs something added within an API generation.
   */
  readonly requires?: string;
  /** Plugin names that must be present; they are set up first. */
  readonly dependsOn?: readonly string[];
  /** Lower runs first among plugins that do not depend on each other. Default 0; ties keep config order. */
  readonly order?: number;
  setup(api: PluginApi): void | Promise<void>;
}

/** A plugin as a config file lists it: the plugin, a module specifier, or `[specifier, options]` (JSON configs). */
export type PluginSpec = ReplaysPlugin | string | readonly [string, unknown];

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AuthAdapter, AuthPluginFactory, Identity } from '../server/auth/types.ts';
import type { ThemeTokens } from '../server/branding.ts';
import type { ObjectStorage } from '../server/storage/types.ts';
import type { ReplayContext } from '../shared/context.ts';
import type { ReplayPerson } from '../shared/people.ts';
import type { RedactionRules } from '../shared/redaction.ts';
import type { PurposeConfig } from '../shared/purposes.ts';
import type { ReplayBundle, ReplaySourceLink, ReplaySummary, SummaryFieldValue } from '../shared/replay.ts';
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
  /** The parsed JSON body of a canonical or registered upload endpoint, before any validation. Untrusted; may not even be an object. */
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

/**
 * What a purpose's `infer` sees: the replay's summary (the index's data: counts, sources, tags, suite run…) plus
 * `errors` (console errors + failed requests). It runs whenever the server lists a replay without an explicit
 * `meta.purpose`, so a changed rule applies to stored replays too. Keep it cheap and pure.
 */
export type PurposeInferInput = Readonly<Omit<ReplaySummary, 'purpose' | 'purposeInferred' | 'kept' | 'expiresAt'>> & {
  readonly errors: number;
};

/** A purpose (src/shared/purposes.ts) plus, optionally, how to recognise one that was uploaded without `meta.purpose`. */
export interface PurposeDefinition extends PurposeConfig {
  /** True when a replay without an explicit purpose has this one. Purposes are tried in `order`; the first match wins. */
  infer?(input: PurposeInferInput): boolean;
}

/** A retention policy that is not about purpose (`api.retention`). */
export interface RetentionRuleDefinition {
  /** Whole days to keep the replay, or `0` / `undefined` for no limit. The shortest window wins; Keep still overrides. */
  days(summary: ReplaySummary): number | null | undefined;
}

/** What the render pipeline makes: a video export, or one of the list media (poster, opening still, hover preview). */
export type RenderKind = 'video' | 'poster' | 'open' | 'preview';

/** The options of a video export a `beforeRender` hook may change. List media have none (`{}`). */
export interface RenderJobOptions {
  /** One of 0.5, 1, 1.5, 2, 4, 8. */
  speed?: number;
  /** Draw the step captions into the frames. */
  captions?: boolean;
  /** Fast-forward idle gaps. */
  skipInactive?: boolean;
}

/**
 * A render as the hooks see it: a small, stable object, not the queue's state. `id` names the job (for a video,
 * `<replayId>-<variant>`; for list media, `<replayId>-<kind>`). `identity` is the person who asked for a video export;
 * list media are made in the background for whoever lists the replay, so they have none.
 */
export interface RenderJob {
  readonly id: string;
  readonly replayId: string;
  readonly kind: RenderKind;
  readonly options: Readonly<RenderJobOptions>;
  readonly identity?: Identity;
}

/** The file a render produced. `file` is a local temporary path, readable until the hook returns; `key` is where it is stored. */
export interface RenderedFile {
  readonly file: string;
  readonly key: string;
  readonly contentType: string;
  readonly bytes: number;
}

/** `api.render`: hooks into posters and video exports. Every member is optional; hooks run in plugin order. */
export interface RenderHooks {
  /**
   * The poster's moment, in ms on the replay's timeline (clamped to the replay). The first hook that returns a finite
   * number wins; `undefined` passes to the next, then to the purpose's `poster` setting, then to the default. Its
   * answer is cached per replay for the life of the process, so keep it a pure function of the bundle and purpose.
   */
  posterAt?(bundle: ReplayBundle, context: { purpose?: string }): number | undefined | Promise<number | undefined>;
  /**
   * Before a render. Return `false` to refuse it, or some of `options` to change them (video exports only; other keys
   * are ignored). Video hooks run on every request that names an export (start, status, download, cancel), so the
   * same request always maps to the same video: keep them cheap and deterministic. A hook that throws refuses the job.
   */
  beforeRender?(job: RenderJob): void | false | Partial<RenderJobOptions> | Promise<void | false | Partial<RenderJobOptions>>;
  /** After a video, poster, opening still or preview is stored. Errors are logged; they never fail the render. */
  afterRender?(job: RenderJob, file: RenderedFile): void | Promise<void>;
}

/**
 * Small indexable values derived from each bundle when its summary is built (at upload, and whenever a summary is rebuilt):
 * the index lists summaries, not bundles, so a column or filter can only use what is here. The values land in
 * `summary.ext[<plugin name>]`, capped (`SUMMARY_FIELD_LIMITS`). A throwing `fields` is logged and its set left out.
 */
export interface SummaryFieldsDefinition {
  /** `[a-z][a-z0-9-]{0,39}`, unique within the plugin. */
  readonly name: string;
  /** Bump when `fields` derives something different: stored summaries built by another version are rebuilt. Default 1. */
  readonly version?: number;
  fields(
    bundle: Readonly<ReplayBundle>,
  ): Record<string, SummaryFieldValue> | undefined | Promise<Record<string, SummaryFieldValue> | undefined>;
}

/**
 * A server-side filter of `GET /api/replays`: with `?<param>=<value>` in the request, only summaries for which
 * `match(summary, value)` is true are listed. The browser's filter control (`registerIndexFilter`) sets the same param.
 */
export interface IndexFilterDefinition {
  /** `[a-z][a-z0-9-]{0,39}`, unique within the plugin. */
  readonly id: string;
  /** The query parameter, namespaced `x-<name>` so it never clashes with the core's (`q`, `host`, `tag`, …); unique. */
  readonly param: string;
  /** `value` is the parameter's value, trimmed (at most 200 characters, never empty). A throw counts as no match. */
  match(summary: Readonly<ReplaySummary>, value: string): boolean;
}
/** A trusted host's exact route-scoped browser intake policy. Authentication still runs for actual requests. */
export interface RequestPolicy {
  /** Canonical path without the deployment base prefix. No patterns. */
  readonly path: string;
  readonly methods: readonly string[];
  /** Serialized http(s) origins, without trailing slashes. No wildcards or opaque origins. */
  readonly origins: readonly string[];
  /** Allowed preflight request header names (case insensitive). */
  readonly headers: readonly string[];
  readonly credentials?: boolean;
}

/** An additional POST route into the core upload pipeline; no CORS policy is implied. */
export interface UploadEndpoint {
  /** A distinct `/api/<name>` path, without the deployment base prefix. */
  readonly path: string;
  /** Runs before global prepareUpload hooks; the result still passes core validation and privacy checks. */
  readonly prepare?: PrepareUploadHook;
}
export interface RequestHookOptions {
  /** `post-auth` (default): only authenticated requests arrive, with `identity`. `pre-auth`: every request, before auth. */
  phase?: 'pre-auth' | 'post-auth';
}

/** An account kind people can be linked by (`person.handles.<id>`), and that a signed-in person can link for "For me". */
export interface PersonHandle {
  /** `[a-z][a-z0-9-]{0,39}`: the key in `person.handles` and the `handle.<id>` query parameter. */
  readonly id: string;
  /** What the viewer calls it (`GitHub username`). */
  readonly label: string;
  /** A regular expression source a value must match as a whole, ignoring case (`^[a-z0-9-]{1,39}$`). */
  readonly pattern: string;
}

/** The deployment's people: roles, checks, handles and links (`api.people`). */
export interface PeopleOptions {
  /** The known roles, in priority order for "For me" (the best-ranked matching role is the `reason`). Without it, roles are free text. */
  readonly roles?: readonly string[];
  /** Return a message to refuse a person (the upload or registration answers 400 naming them); nothing to accept. */
  validate?(person: ReplayPerson): string | undefined | void;
  /** The handles people may carry. Without it, any handle id is accepted (shape and size only). */
  readonly handles?: readonly PersonHandle[];
  /** An https avatar image for a person, resolved per response (anything else is dropped). */
  avatarUrl?(person: ReplayPerson): string | undefined | null | false | void;
  /** An https profile link for a person, resolved per response; `sources` are the row's source links. */
  profileUrl?(person: ReplayPerson, context: { sources: readonly ReplaySourceLink[] }): string | undefined | null | false | void;
}

/** Enriches the signed-in identity after authentication (a display name and avatar from a directory). */
export interface IdentityResolver {
  /**
   * Return the identity to use, or nothing to keep it. Only `name`, `avatarUrl` (https) and, when the auth adapter
   * gave none, `email` are taken; an identity with another `id` is refused (logged, and the request keeps the original).
   * Runs once per request.
   */
  resolve(identity: Identity, context: { request: IncomingMessage }): Identity | undefined | void | Promise<Identity | undefined | void>;
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
  /** Exact-origin CORS and a narrow CSRF exception. Only preflights bypass authentication. */
  requestPolicy(policy: RequestPolicy): void;
  /** Register a POST alias using the normal auth, CSRF and complete core upload pipeline. */
  uploadEndpoint(endpoint: UploadEndpoint): void;
  onRequest(hook: RequestHook, options?: RequestHookOptions): void;
  onResponse(hook: ResponseHook): void;
  /** Translate the raw upload body before validation (legacy producers). */
  prepareUpload(hook: PrepareUploadHook): void;
  beforeUpload(hook: BeforeUploadHook): void;
  afterUpload(hook: AfterUploadHook): void;
  /** A browser entry that registers inspector tabs, viewer actions and panels, and index columns, filters and sections. */
  client(entry: ClientEntry): void;
  /**
   * Redaction rules added to the sanitiser's defaults (never weakening them), in the capture CLI and the server's privacy
   * pass. Rules from several plugins and the config file's `redaction` add up. Trusted config: see docs/extending.md.
   */
  redaction(rules: RedactionRules): void;
  /**
   * A purpose. Ids are unique across plugins; a `purposes` entry in the config file with the same id overrides its
   * fields (not `infer`).
   */
  purpose(definition: PurposeDefinition): void;
  /** A retention rule; the shortest window any rule, the purpose or the default gives wins. */
  retention(rule: RetentionRuleDefinition): void;
  /** Render pipeline hooks: the poster's moment, a check before each render, and a call after each file is stored. */
  render(hooks: RenderHooks): void;
  /** Values derived into `summary.ext[<plugin name>]` for the index (columns, filters). */
  summaryFields(definition: SummaryFieldsDefinition): void;
  /** A server-side filter of the replay list, selected by an `x-*` query parameter. */
  indexFilter(definition: IndexFilterDefinition): void;
  /** Roles, validation, handles and avatar/profile links for `meta.people`. Once per deployment: a second call is a conflict. */
  people(options: PeopleOptions): void;
  /** Enrich the signed-in identity after auth. Resolvers run in plugin order, each on the previous one's result. */
  identity(resolver: IdentityResolver): void;
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

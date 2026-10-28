# Extension API

This is the reference for building a **custom distribution** on top of replays without forking it: a config file, plugins
for the server, and a browser entry for the viewer. A runnable example is [`examples/custom-distro`](../examples/custom-distro);
the stability promise is in [api-stability.md](api-stability.md), the packaging decision in [packaging.md](packaging.md), and the overall
design (layers, the full list of extension points, and the plan) in [architecture/extensibility.md](architecture/extensibility.md).
The older, single-purpose extension points (auth adapter, storage interface, context schema, source providers, theme tokens)
keep working as before and are described in [extending.md](extending.md); this API wraps them so one package can carry all of them.

```
your-distro/
  package.json            depends on @hazem3500/replays (one version, pinned)
  replays.config.ts       defineConfig({ plugins: [...], name, basePath, … })
  src/plugin.ts           definePlugin(...): auth, context, links, storage, branding, hooks
  src/client.ts           defineViewerPlugin(...): inspector tabs, actions, panels, index slots → bundled to one .js
  src/server.ts           await startServer()      # or just `replays serve`
```

## Entry points

| Import | For | Runs in |
| --- | --- | --- |
| `@hazem3500/replays/config` | `defineConfig`, `loadConfig` | Node |
| `@hazem3500/replays/plugin` | `definePlugin`, `rejectUpload`, `PluginError`, plugin types | Node |
| `@hazem3500/replays/viewer` | `defineViewerPlugin`, viewer plugin types (no Node, no React) | browser |
| `@hazem3500/replays/server` | `startServer`, `createApp`, `buildStatic`, `renderIndexHtml`, storage (drivers, `ObjectExistsError`, `PreconditionFailedError`, `NotFoundError`, `assertKey`, `globToRegExp`), auth (adapters, `verifyJwt`), store, `migrateStore` / `compareStores` (`replays migrate`, [operations.md](operations.md#converting-stored-replays)) | Node |
| `@hazem3500/replays/server/testing` | `describeObjectStorage`, `describeAuthAdapter`, `fakeRequest`: the contract suites the built-in adapters pass | Node, any test runner |
| `@hazem3500/replays/plugins/iap` | First-party plugin: Google Cloud Identity-Aware Proxy sign-in ([below](#first-party-plugins)) | Node |
| `@hazem3500/replays/plugins/gcs` | First-party plugin: Google Cloud Storage over its JSON API ([below](#first-party-plugins)) | Node |
| `@hazem3500/replays/capture` | recording, bundle building, sanitising, source providers | Node |
| `@hazem3500/replays` | the original umbrella entry (kept for compatibility) | Node |

## The config file

`replays.config.ts`, `.mjs`, `.js` or `.json` in the working directory, or the file named by `REPLAYS_CONFIG`. The first
that exists of `.ts`, `.mjs`, `.js`, `.json` wins. A script default-exports the config:

```ts
import { defineConfig } from '@hazem3500/replays/config';
import acme from './src/plugin.ts';

export default defineConfig({
  name: 'Acme Replays',          // PRODUCT_NAME
  logoUrl: 'https://…/logo.svg', // LOGO_URL
  theme: { dark: { accent: '#ff6600' }, light: { accent: '#b84700' } },
  basePath: '/replays',          // BASE_PATH
  hosts: { 'replays.example.com': { basePath: '/' } },   // a different base for this Host; others keep basePath
  trustForwardedHost: false,     // TRUST_FORWARDED_HOST: pick the host from X-Forwarded-Host (a gateway that rewrites Host)
  retentionDays: 30,             // RETENTION_DAYS
  profiles: [{ id: 'triage', label: 'Triage', retentionDays: 90 }],   // see "Profiles and retention" below
  contextSchemaFile: './context.schema.json',
  githubHost: 'github.example.com', gitlabHost: 'gitlab.example.com',
  sourceProviders: [{ id: 'jira', template: 'https://jira.example.com/browse/{ref}' }],
  beta: { editor: false },
  // Sandboxed user plugins (beta): `enabled` is the same switch as beta.malleable; the rest only narrows. File only.
  malleable: { enabled: true, scopes: ['user'], capabilities: { 'export:download': 'deny' }, lockedSurfaces: ['inspector:context'] },
  distribution: { name: 'acme-replays', version: '2.3.0' }, // shown in /api/config, recorded by kept user plugins. File only.
  auth: 'acme-iap',              // AUTH_MODE: a built-in mode or an adapter a plugin registered
  storage: 'gcs',                // STORAGE: fs, s3 or a backend a plugin registered
  redaction: { jsonKeys: ['ssn'], maskSelectors: ['[data-private]'] }, // added to the sanitiser's defaults
  plugins: [acme({ audience: 'acme-replays' })],
});
```

- **Precedence** for every setting that has one: environment variable, then the config file, then plugins, then the built-in default.
  Secrets (client secrets, storage credentials) are environment-only; never put them in the file.
- Relative paths in the file (`contextSchemaFile`, plugin specifiers) are relative to the file's directory; paths in environment
  variables are relative to the working directory.
- Unknown keys are an error naming them.
- A `.ts` config needs Node 22.18+ (type stripping is on by default) or `--experimental-strip-types`; `replays serve` and the
  repository's scripts pass the flag. Type stripping does not work for files under `node_modules`, so a *published* plugin ships
  JavaScript. A `.js` config is read as an ES module (Node detects the syntax); `.mjs` is unambiguous.
- JSON configs list plugins by module specifier: `"plugins": ["./plugin.mjs", ["acme-replays-plugin", { "audience": "x" }]]`. The
  module's default export is a plugin, or a function of the options that returns one. Bare specifiers resolve from the config's directory.

## Plugins

```ts
import { definePlugin } from '@hazem3500/replays/plugin';

export default definePlugin((options: { audience: string }) => ({
  name: 'acme-distro',           // [a-z][a-z0-9-]{0,39}; unique
  dependsOn: ['acme-base'],      // optional: set up after these (they must be listed)
  requires: '>=0.4 <0.6',        // optional: the @hazem3500/replays versions it works with
  order: 0,                      // optional: lower first among independent plugins
  setup(api) {
    api.auth({ name: 'acme-iap', create: (env) => ({ name: 'acme-iap', authenticate: (request) => … }) });
    api.branding({ name: 'Acme Replays' });
  },
}));
```

`definePlugin(plugin)` returns the plugin; `definePlugin((options) => plugin)` returns a factory you call in the config. `apiVersion`
is filled in (`PLUGIN_API_VERSION`, currently `1`); a plugin written for another version is refused at start with both numbers named.

**`requires`** (optional) is a semver range over this package's version, for a plugin that uses something added within an API
generation: `>=0.4 <0.6`, `^0.4.1`, `~0.4`, `0.4.2`. Supported: `>=`, `>`, `<`, `<=`, `=` or a bare version (a partial one such as
`0.4` means all of `0.4.x`), `^`, `~`, and space-separated terms that must all hold; no `||`, hyphen ranges or `x`. A malformed
range is an `invalid-plugin` error; a core outside the range refuses the plugin at start with `version-range`, naming the range and
the installed version.

**Ordering.** Plugins are set up dependencies first, then by `order` (default 0, ascending), then by position in the config.
Hooks and context adapters run in that same order. A missing dependency, a duplicate name or a cycle is a start-up error.

**Errors.** Everything found at start throws a `PluginError` with a stable `code` (`invalid-plugin`, `duplicate-plugin`,
`api-version`, `version-range`, `missing-dependency`, `dependency-cycle`, `invalid-registration`, `conflict`, `setup-failed`, `load-failed`) and a
message that starts with the plugin's name. The server prints it and exits; nothing listens.

### What `setup(api)` can register

| Call | Registers | Conflicts |
| --- | --- | --- |
| `api.auth(adapter \| { name, create(env) })` | An [`AuthAdapter`](extending.md#auth-adapters) selected by `AUTH_MODE=<name>` or the config's `auth`. With exactly one registered and nothing chosen it is used; with several and nothing chosen the server refuses to start | name taken by another plugin or built in (`none`, `header`, `oidc`, `plugin`) |
| `api.contextAdapter({ name, schema?, normalize? })` | Runs on every upload and suite registration, **before** validation: `normalize(context, { kind, identity, request })` returns the context to use. `schema` (an object schema) is merged into the deployment's context schema, which validates the result and titles the Context tab | name taken; a field defined differently by two adapters or by the schema file |
| `api.sourceProvider(provider)` | A `{ id, label, icon?, noun?, resolve(ref) }` link provider (chat, support, VCS style), usable as `--source id:ref` and in `context.sources`. `icon` (a `data:image/svg+xml` or https URL) and `noun` (`'Chat thread'`) are how the viewer shows its sources; `resolve` may return `attrs` ([details](extending.md#source-link-providers)) | id taken, built in (`github`, `gitlab`, `url`) or defined in the config's `sourceProviders`; an icon that is not a safe image URL |
| `api.storage({ id, create({ env, dataDir }) })` | An [`ObjectStorage`](extending.md#storage) selected by `STORAGE=<id>` or the config's `storage`. Its `kind` is any string (usually the id); set `listCacheMs` when listing is remote and slow | id taken or built in (`fs`, `s3`, `memory`) |
| `api.branding({ name?, logoUrl?, theme? })` | Name, logo (https URL or base64 data image) and [theme tokens](extending.md#theming-and-branding) | the same field set to different values by two plugins; the config file and environment override plugins without error |
| `api.basePath('/replays')` | The default base path | two plugins disagree; config and `BASE_PATH` override |
| `api.requestPolicy({ path, methods, origins, headers, credentials? })` | [Trusted route policy](#trusted-browser-intake-and-upload-aliases): exact-origin CORS, preflight validation and a narrow CSRF exception; actual requests retain auth | overlapping path/method registration |
| `api.uploadEndpoint({ path, prepare?, authenticate?, maxBytes?, rateLimit?, normalize?, receipt? })` | A [custom upload endpoint](#custom-upload-endpoints) into the core upload pipeline, optionally with its own credentials, body cap, rate limit, normalization and receipt; no implicit CORS | duplicate path or a reserved core path |
| `api.onRequest(hook, { phase? })` | `hook({ request, response, path, identity? })`, return `true` after answering. `post-auth` (default): only authenticated requests, with `identity`, after the same-origin check. `pre-auth`: requests not already answered by health checks or route policies. `path` has the base path removed | – |
| `api.onResponse(hook)` | `hook({ method, path, status, durationMs, identity? })` after each response; errors are logged | – |
| `api.prepareUpload(hook)` | `hook({ body, identity, request })` on the raw canonical or alias upload body before any validation; return the body to use (translate a producer's older shape) | – |
| `api.normalizeUpload(hook)` | `hook({ bundle, identity, request, path })` on every validated upload (`POST /api/replays` and [upload endpoints](#custom-upload-endpoints)) before the privacy pass; return or mutate the bundle. The result is validated again, then sanitized | – |
| `api.beforeUpload(hook)` | `hook({ bundle, identity, request })` on the validated, sanitised bundle before it is stored. Throw `rejectUpload(status, message)` to refuse; return a bundle to replace it (it is validated again). Also runs for `POST /api/replays/import` | – |
| `api.afterUpload(hook)` | `hook({ bundle, identity, request, url })` after the bundle is stored; errors are logged and never fail the upload | – |
| `api.redaction({ headers?, queryParams?, jsonKeys?, text?, maskSelectors? })` | [Redaction rules](extending.md#redaction-rules) added to the sanitiser's defaults, in the capture CLI (which reads the same config) and the server's privacy pass. Rules from several plugins and the config's `redaction` add up; they cannot turn a default off. Validate your own with `assertRedactionRules` (`/plugin`, `/capture`) | – (invalid rules are an `invalid-registration`) |
| `api.client({ id, script, style? })` | A browser entry, served by the app behind the same auth (an absolute file path) or loaded from an `https:` URL | the same `id` twice in one plugin |
| `api.profile({ id, label, order?, retentionDays?, viewer?, poster?, infer? })` | A [profile](#profiles-and-retention): why a replay was recorded. `infer(input)` recognises one uploaded without `meta.profile` | id taken by another plugin (a config entry with the same id overrides its fields instead) |
| `api.retention({ days(summary) })` | A [retention rule](#profiles-and-retention) that is not about profile: whole days, or `0` / `undefined` for no limit | – |
| `api.render({ posterAt?, beforeRender?, afterRender? })` | [Render pipeline hooks](#render-pipeline-hooks): the poster's moment, a veto or option change before each render, a call after each stored file | – (hooks run in plugin order) |
| `api.summaryFields({ name, version?, fields(bundle) })` | Small values for the index, derived into `summary.ext[<plugin>]` whenever a summary is built ([below](#the-index-summary-fields-columns-filters-sections)) | the same `name` twice in one plugin |
| `api.indexFilter({ id, param, match(summary, value) })` | A server-side filter of `GET /api/replays` selected by `?<param>=<value>`; `param` is `x-<name>` ([below](#the-index-summary-fields-columns-filters-sections)) | the same `id` twice in one plugin; a `param` taken by any plugin |
| `api.people({ roles?, validate?, handles?, avatarUrl?, profileUrl? })` | The deployment's [people](#people-and-identity): role priority, checks on `meta.people` and suite `people`, linkable handles, avatar and profile links | a second registration (one per deployment) |
| `api.identity({ resolve(identity, { request }) })` | Enriches the signed-in identity after auth (a display name and avatar from a directory); see [People and identity](#people-and-identity) | – |

Upload order: endpoint `prepare` (aliases only) → `prepareUpload` → context adapters → source links resolved → validation and context schema → privacy pass →
`beforeUpload` → store → `afterUpload`. The core checks cannot be skipped by a hook: an adapter or hook that produces an
invalid bundle gets a `400`.

`GET /api/config` lists the plugins that are loaded (`plugins: ["acme-distro"]`), the auth adapter in use, and the plugin index
filters when there are any (`indexFilters: [{ plugin, id, param }]`).

### People and identity

Producers say who a recording or suite is about with `meta.people` (and `people` on a suite registration):
at most 10 `{ role, email?, name?, handles? }`, each with an email or a handle, at most 4096 bytes of JSON in all. The shape and size are
always checked; without `api.people` a role is free text and any handle id is accepted. The capture and import CLIs take repeatable
`--person role:email[:handle=value]…` (`reviewer:ada@example.com:github=ada`, or `reviewer::github=ada` without an email);
`POST /api/replays/import` takes the same as repeatable `?person=`. Registering a suite again with only `people` changed replaces them
(absent keeps them); anything else that differs is still a `409`.

```ts
api.people({
  roles: ['pr-author', 'reviewer', 'requester', 'assignee', 'uploader', 'mentioned'], // priority order for "For me"
  validate: (person) => (person.email?.endsWith('@example.com') ? undefined : 'staff only'),
  handles: [{ id: 'github', label: 'GitHub username', pattern: '^[a-z0-9-]{1,39}$' }],
  avatarUrl: (person) => person.handles?.github && `https://github.com/${person.handles.github}.png`,
  profileUrl: (person, { sources }) => person.handles?.github && `https://github.com/${person.handles.github}`,
});
```

- **One registration per deployment**; a second one stops the server (`conflict`).
- **`roles`** is the priority order. With it, an unknown role is refused; it also decides the `reason` of a "For me" match.
- **`handles`**: the account kinds people may carry and a signed-in person may link. A `pattern` is a regular expression source
  matched against the whole value, ignoring case. With `handles`, an unknown handle id or a value that does not match is refused.
- **`validate(person)`** returns a message to refuse a person. Uploads, imports and suite registrations answer `400` naming them:
  `replay.meta.people[0] (reviewer eve@elsewhere.test): staff only`. A `validate` that throws is a `500`.
- **`avatarUrl(person)` and `profileUrl(person, { sources })`** run on the way out, per response, and only `https:` URLs are sent (anything
  else is dropped, as is the link of a callback that throws). `sources` are the row's source links. Nothing they return is stored.

The API (`summary.people` and suite `people` carry `avatarUrl` and `profileUrl` when resolved):

| Request | |
| --- | --- |
| `GET /api/replays?for=me` | Only replays whose people match the signed-in person, each with `reason`: the best-ranked matching role |
| `GET /api/suites?for=me` (and `&expand=runs`) | Suites matching through their own people or any run's replay people, with `reason` |
| `…&handle.<id>=value` | Handles the person linked (the viewer keeps them in localStorage); each must match its pattern, else `400` |
| `GET /api/me` | The (resolved) identity, plus `people: { roles?, handles: [{ id, label, pattern }] }` with `api.people` |

A person matches by email (the identity's) or by a linked handle, both ignoring case. The viewer shows an avatar stack on index rows
that have people (a card with name, role, email to copy and profile link) and a **For me** switch in the filter menu with a field per
linkable handle; neither appears when no row has people and the deployment registered none.

`api.identity({ resolve(identity, { request }) })` runs once per request, right after the auth adapter, before the request hooks;
resolvers run in plugin order, each on the previous result, and may be async. From what `resolve` returns, only `name`, an `https:`
`avatarUrl`, and `email` when the adapter gave none are taken. A result with a different `id` is refused (logged; the request goes on
with the identity it had), as is a resolver that throws: `id` stays the auth adapter's.

**Avatars and the page's CSP.** The viewer page sends no `img-src` restriction (only `frame-src` with the beta user plugins), so an
avatar from any host loads. Instead the server sends only `https:` avatar URLs (identity resolvers and `api.people` alike), and the
viewer renders them with `referrerPolicy="no-referrer"`, falling back to initials. A deployment that adds its own CSP should allow
`img-src https:` for avatars.

### Choosing an auth adapter

```
AUTH_MODE (env)  →  config.auth  →  the only plugin adapter  →  built-in default (none)
```

A name is looked up among plugin adapters first, then the built-ins. `AUTH_MODE=plugin AUTH_PLUGIN=./x.mjs` (the older
mechanism) still works.

## Profiles and retention

A profile answers "why was this recorded?" (a bug triage, a design review, a walkthrough) and changes how a replay is kept,
opened, listed and drawn. **The core defines none.** A deployment declares them in the config file, or a plugin registers
them (and only a plugin can *infer* one):

```ts
// replays.config.ts (or the same list in replays.config.json)
profiles: [
  { id: 'triage', label: 'Triage', retentionDays: 90, viewer: { openAt: 'first-error', leadMs: 1000, inspector: 'open' }, poster: 'first-error' },
  { id: 'walkthrough', label: 'Walkthroughs', order: 2, retentionDays: 0, viewer: { inspector: 'collapsed', captions: true }, poster: 'last-step' },
],

// a plugin
api.profile({ id: 'triage', label: 'Triage', infer: ({ errors, sources }) => errors > 0 && sources?.some((s) => s.provider === 'jira') === true });
api.retention({ days: (summary) => (summary.tags?.includes('scratch') ? 3 : undefined) });
```

| Field | Meaning |
| --- | --- |
| `id` | `[a-z][a-z0-9-]{0,39}`; unique |
| `label` | Shown on the index tab, the upload picker and in `/api/config` (at most 40 characters) |
| `order` | Lower first (tabs, and the order `infer` is tried in). Default 0; ties keep declaration order: config entries first, then plugins in plugin order |
| `retentionDays` | Whole days to keep a replay of this profile; `0` keeps it forever. `RETENTION_PROFILE_<ID>_DAYS` overrides it (the id upper-cased, `-` as `_`: `RETENTION_PROFILE_DESIGN_REVIEW_DAYS`). Absent: `retentionDays` / `RETENTION_DAYS` |
| `viewer.openAt` | `'start'` (default) or `'first-error'`: open `viewer.leadMs` (default 1000) before the first console error or failed request, on the tab that holds it. A permalink (`?t=`, `#step-…`) wins |
| `viewer.inspector` | `'open'` or `'collapsed'`: the bottom panel when the person has no stored choice |
| `viewer.captions` | Step captions on the player when the person has no stored choice |
| `poster` | The list thumbnail's moment: `'middle-step'` (the default), `'first-error'` or `'last-step'`. A plugin's [`posterAt`](#render-pipeline-hooks) wins over it |
| `infer(input)` | Plugins only. `input` is the replay's summary (counts, `sources`, `tags`, `suiteRun`, `title`, `url`, …) plus `errors`; return `true` to claim the replay. The first profile (in `order`) that says yes wins; a throwing `infer` counts as no and is logged once |

- **Config and plugins.** Two plugins registering the same id is a `conflict` error. A config entry with a plugin profile's id
  overrides that profile's fields (`viewer` key by key) and keeps its `infer`, so a host can retune a plugin's profile without code.
  A malformed entry stops the server with the field named.
- **Uploads** may carry `meta.profile` (`POST /api/replays`), or `?profile=` on `POST /api/replays/import`. It must be one of the
  registered ids; anything else is a `400` naming the allowed ids. With no profiles registered, an upload that carries one is
  refused (`400`, "this server defines no profiles") rather than stored with a profile nothing knows: a producer finds out at once,
  and a `prepareUpload` hook can drop or translate the field. The CLI takes `--profile <id>` on `capture`, `upload` and `import`;
  the upload dialog offers a picker (bundles and rrweb imports) when profiles exist.
- **Summaries** gain `profile` and `profileInferred` (`SUMMARY_VERSION` 9). Only the explicit profile is stored in the sidecar;
  inference runs when the server lists, so a changed rule applies to stored replays at once. Removing a profile from the
  config leaves `meta.profile` in the stored bundles; it is shown as a plain field and no longer affects anything.
- **Listing.** `GET /api/replays?profile=<id>` filters; `GET /api/config` lists `profiles` (`[]` in a plain core); the index shows
  "All · <profile> …" tabs with counts (only when profiles exist), kept in the URL as `profile=`. A suite counts under the profiles
  of its runs' replays.
- **Viewer.** A replay's profile is its `meta.profile`, else the inferred one, which the server sends as
  `x-replay-profile: <id>; inferred` with the bundle (cached with it for up to a day). The viewer marks it as `data-profile` on
  `main.app-shell`.
- **Retention.** The profile's window replaces the default one. **An inferred profile never makes a replay permanent**: if its
  window is `0`, the default window applies; only an explicit profile (or Keep) keeps a replay forever. `api.retention` rules can
  only shorten: the shortest positive window among the default/profile window and every rule wins, `0` or `undefined` means no
  limit from that rule, and **Keep** (or a kept suite) still overrides everything. A rule that throws or returns something other
  than a whole number of days is logged once and ignored. Rules see the summary, so they apply to replays, not to suites (suites
  use the default window).
- **Renamed from purposes.** Profiles were called purposes. Every old name still works and is deprecated (see
  [API stability](api-stability.md#deprecated-purpose-names) for the list and the removal window): the config key
  `purposes`, `api.purpose`, `meta.purpose`, `summary.purpose`/`purposeInferred`, `--purpose`, `?purpose=`,
  `RETENTION_PURPOSE_<ID>_DAYS`, `x-replay-purpose` and `purposes` in `/api/config`. Setting both spellings to different
  values is refused. [downstream-migration.md](downstream-migration.md#renaming-purposes-to-profiles) has the steps.

## Render pipeline hooks

Posters (the index thumbnails), opening stills, hover previews and video exports are made by headless Chromium on the server.
`api.render` hooks into all of them:

```ts
api.render({
  // The poster's moment in ms on the replay's timeline; undefined passes to the next hook.
  posterAt: (bundle, { profile }) => (profile === 'checkout' ? bundle.steps.find((step) => step.kind === 'submit')?.at : undefined),
  // false refuses; an object changes options (video exports only).
  beforeRender: (job) => (job.kind === 'video' && !job.identity?.email?.endsWith('@example.com') ? false : { speed: 2 }),
  // After each stored file; errors are logged and never fail the render.
  afterRender: async (job, { file, key, contentType, bytes }) => copyToCdn(file, `${job.replayId}/${key.split('/').at(-1)}`),
});
```

**The job** every hook gets is a small, frozen object, not the queue's state; it may grow new optional keys within the API generation:

| Field | Meaning |
| --- | --- |
| `id` | The job: `<replayId>-<variant>` for a video (`test-replay-2x-skip-cc`), `<replayId>-<kind>` for list media |
| `replayId` | The replay |
| `kind` | `'video'`, `'poster'`, `'open'` (the opening still) or `'preview'` (the hover clip) |
| `options` | Video: `{ speed, captions, skipInactive }`. List media: `{}` |
| `identity` | Video: who asked for the export. List media are made in the background for whoever lists the replay, so they have none |

- **`posterAt(bundle, { profile })`** picks where the poster is taken. Hooks run in plugin order and the first one that returns a
  finite number (≥ 0) wins; `undefined` passes on. After the hooks comes the profile's `poster` setting
  ([profiles](#profiles-and-retention)), which is the same mechanism's built-in last step, then the default (`middle-step`). The time
  is clamped to the replay and never lands before its first document. A hook that throws or returns something else is skipped and
  logged. The answer is remembered per replay for the life of the process (a bundle never changes), so keep it a pure function of the
  bundle and the profile; the bundle is only read when a `posterAt` hook exists.
- **Poster caching.** A poster's file name says which moment it shows: `poster.v2.jpg` for the default, `poster.v2-first-error.jpg`
  for a profile setting, `poster.v2-t<ms>.jpg` for a hook's time. When a deploy changes the choice for a replay, its next poster
  request looks for a new name, so the old file is never served again and a new one is made (the old one is pruned with the
  replay). Posters stored where nothing chooses keep their name, so adding hooks never invalidates the default ones. Browsers
  that cached a poster (a week) keep showing it until that expires.
- **`beforeRender(job)`** runs before each render. Return `false` to refuse it; return some of `{ speed, captions, skipInactive }` to
  change a video export (`speed` one of 0.25, 0.5, 1, 1.5, 2, 4, 8; the others booleans). Other keys, invalid values and option changes
  for list media are ignored and logged once. Hooks run in plugin order, each one sees the options as changed so far, and the first
  `false` stops. A hook that throws refuses the job too (a broken policy check must not let everything through).
  - For video exports it runs on every request that names an export (start, status, download, cancel), so the adjusted options name
    the same video for all of them: keep it cheap and deterministic. A refusal answers `{ "status": "refused", "error": "this export
    is not allowed here" }`: `403` to start, download or cancel, `200` to the viewer's status probe. The viewer shows the message.
  - For list media it runs when the job starts; a refused job counts as failed (the index keeps its placeholder, `404` for the file)
    and is tried again after ten minutes, like any failure.
- **`afterRender(job, { file, key, contentType, bytes })`** runs after a file is stored: each video export, poster, opening still
  (also the one a poster job makes on the way) and preview. `file` is a local temporary path, readable until the hook returns; `key`
  is the stored object's key. Hooks run in plugin order and are awaited before the job's temporary files are removed (a video already
  reads as done), so a slow hook holds its render slot. Errors are logged and never fail the render or reach the next hook.

## Built-in plugins

Comments ship as a plugin, `comments`, so they use the same surface as yours and follow the same rules:

- **Server** (`src/server/comments-plugin.ts`): `definePlugin({ name: 'comments', order: -100, setup })` registers the comments API with
  `api.onRequest` (post-auth). Because it runs after authentication, whatever adapter is active, a plugin's included, decides who
  the author is: the `Identity` (`id` for ownership, `name`, optional `avatarUrl` as an https URL) is stored as the comment's author.
- **Loading**: `REPLAYS_COMMENTS` / `comments.enabled` (default on) decides whether the server adds the plugin. Absent means no routes (404)
  and no UI; `GET /api/config` shows `comments` and lists `comments` first in `plugins`. The name `comments` is reserved: listing a
  plugin of that name is a `duplicate-plugin` error.
- **Viewer** (`src/client/comments/feature.tsx`): a built-in viewer feature (`src/client/plugins/features.tsx`) with a provider around the viewer, a tab in the
  bottom panel, a seek-bar overlay and the `M` shortcut. Features are the React-side twin of the browser plugin API below, for code in this
  repository that uses the viewer's own components; they are not public API. A feature is active when the page says the server loaded its plugin.

- **`malleable`** (`src/server/malleable-plugin.ts`, beta): user plugins and the agent bridge, a built-in plugin loaded only with
  `REPLAYS_BETA_MALLEABLE` / `beta.malleable` (the name is reserved too). It uses a pre-auth hook (the sandbox page and the agent's
  bearer-token call) and a post-auth hook (plugin storage, approvals, the page's side of the bridge). User plugins register through the
  browser registry (`ViewerRegistry.replacePlugin`, internal, not public API) but run sandboxed, not through `api.client`. See [malleability.md](malleability.md).
  A user plugin registers as `user:<id>` (keys `plugin:user:<id>:<contribution>`); a host plugin's name cannot contain `:`, so the two
  never collide and a user plugin cannot replace or remove a host plugin's tabs, panels or actions.
- **The host's policy for user plugins** (`malleable` in the config, typed `MalleableConfig` from `/config`): the deployment can only
  narrow. `scopes` (`'user'`, `'workspace'`; default personal scope only) says where a plugin may be kept; `capabilities` maps each capability to
  `'allow' | 'ask' | 'deny'` (a write capability, `comments:write` or `export:download`, is `'ask'` or `'deny'`; `'allow'` is a start-up
  error); `lockedSurfaces` lists surfaces user plugins may not replace or hide (`inspector:<tab>`, `inspector:<plugin>:<tab>`,
  `panel:<plugin>:<id>`, `action:<plugin>:<id>`). The server refuses (403) to keep a plugin that declares a denied capability or targets a
  disabled scope, the viewer's broker fails a denied capability with `permission-denied`, and the workshop and agents see the policy.
  `GET /api/config` carries it as `malleable` when the feature is on, plus `core` (this package's version) and `distribution` always
  (when configured). See [malleability.md](malleability.md#the-hosts-policy).

Another built-in feature would follow the same two steps: a server plugin (if it needs routes) and a registered viewer feature.

## First-party plugins

Opt-in plugins shipped with the package for common deployments. They are ordinary plugins: they import only `/plugin` and
`/server` (a test pins that), you list them in the config like your own, and they pass the same contract suites
([testing](#testing-a-plugin)). Each module default-exports a factory of its options; every option also has an environment variable,
and an option given in the config wins over it.

```ts
import { defineConfig } from '@hazem3500/replays/config';
import gcs from '@hazem3500/replays/plugins/gcs';
import iap from '@hazem3500/replays/plugins/iap';

export default defineConfig({
  auth: 'iap',
  storage: 'gcs',
  plugins: [
    iap({ audience: '/projects/123456/global/backendServices/7890', domains: ['example.com'],
          serviceAccounts: ['uploader@example-ci.iam.gserviceaccount.com'] }),
    gcs({ bucket: 'example-replays', prefix: 'replays' }),
  ],
});
```

**`iap(options)`**, auth adapter `iap`, for an app behind Google Cloud's Identity-Aware Proxy:

| Option | Env | |
| --- | --- | --- |
| `audience` | `IAP_JWT_AUDIENCE` | Required. The exact `aud`: `/projects/<number>/global/backendServices/<id>` (load balancer) or `/projects/<number>/apps/<project-id>` (App Engine) |
| `domains` | `IAP_ALLOWED_DOMAINS` | Email domains let in (`example.com`; exact, no subdomains). Comma- or space-separated in the env |
| `serviceAccounts` | `IAP_SERVICE_ACCOUNTS` | Service accounts let in by exact email (an uploader that signs in with an ID token). Only `*.gserviceaccount.com` addresses; any other entry stops the server |
| `devFallback` | – | Local development only: the email used for requests without the IAP header. Requests with one are still verified. Never set it where the app is reachable without IAP |

It verifies `x-goog-iap-jwt-assertion` with `verifyJwt`: ES256 against Google's JWKS (`https://www.gstatic.com/iap/verify/public_key-jwk`,
cached for an hour and refetched at most once a minute for an unknown `kid`), issuer `https://cloud.google.com/iap`, the exact
audience, `iat` required, 30 s leeway. The identity is `{ id: email, email }` (lowercased). A request without a valid assertion, or
from anyone not listed, gets `403`. At least one of `domains` and `serviceAccounts` is required. IAP itself must also admit the
service accounts (IAP-secured Web App User); this only stops the app turning them away.

**`gcs(options)`**, storage backend `gcs`, a Cloud Storage bucket over the JSON API with `fetch` (no SDK):

| Option | Env | |
| --- | --- | --- |
| `bucket` | `GCS_BUCKET` | Required |
| `prefix` | `GCS_PREFIX` | Keys live under `<prefix>/` |
| – | `GOOGLE_OAUTH_ACCESS_TOKEN` | A fixed access token. Without it, tokens come from the GCE metadata server (Workload Identity on GKE, the attached service account on Cloud Run and Compute Engine; `GCE_METADATA_HOST` to override), cached until a minute before they expire |
| – | `STORAGE_EMULATOR_HOST`, `GCS_API_ENDPOINT` | An emulator (`localhost:4443`; no token is sent unless `GOOGLE_OAUTH_ACCESS_TOKEN` is set) or another endpoint (a token is sent) |

Create-only writes use `ifGenerationMatch=0` and `ifVersion` writes `ifGenerationMatch=<generation>` (a lost race is a `409`, as with the
built-ins); the object's generation is its version. Uploads above 8 MB are resumable, in 8 MB chunks. Listing uses `matchGlob`
server-side (and filters again, for emulators without it). It sets `listCacheMs` to 5000, like S3. The service account needs
`roles/storage.objectUser` on the bucket; objects stay private (the server streams them). The module also exports `GcsStorage` for
use without the plugin.

## Browser entries: inspector tabs, actions, panels, timeline tracks, context sections, settings

A server plugin points at one ES module with `api.client({ id: 'main', script: '/abs/path/client.js' })`. (Deployment code uses this DOM-based API; the built-in comments use the React feature registry described above.) The app imports it
after the first paint on every page, the index as well as the viewer, and calls its default export. A failing entry is logged to the console and skipped; it never breaks the viewer
or other plugins. The module is yours to build (the example uses esbuild, `scripts/build.mjs`); it needs no React and no framework:

```ts
import { defineViewerPlugin } from '@hazem3500/replays/viewer';

export default defineViewerPlugin((api) => {
  api.registerInspectorTab({
    id: 'build',               // [a-z][a-z0-9-]*, unique per kind within the plugin
    label: 'Build',
    order: 0,                  // after the built-in tabs; lower first
    render(container, { replay, theme }) { container.textContent = replay.meta.title; /* return a cleanup function if you need one */ },
  });
  api.registerViewerAction({ id: 'copy', label: 'Copy summary', when: (ctx) => true, run: async (ctx) => ctx.notify('Copied') });
  api.registerViewerAction({ id: 'start', label: 'Back to start', placement: 'bar', icon: 'data:image/svg+xml,…', run: (ctx) => ctx.seek(0) });
  api.registerViewerPanel({ id: 'notes', title: 'Notes', slot: 'side', render(container, ctx) { return ctx.onTime((ms) => { … }); } });
  api.registerTimelineTrack({
    id: 'errors',
    label: 'Console errors',
    markers: ({ replay }) => replay.console.filter((e) => e.level === 'error').map((e) => ({ atMs: e.at, label: e.message, tone: 'error' })),
  });
  api.registerContextSection({ id: 'release', title: 'Release', render(container, ctx) { container.textContent = '…'; } });
  api.registerSetting({ id: 'compact', label: 'Compact release', type: 'boolean', default: false });
  api.registerSetting({ id: 'units', label: 'Clock', type: 'choice', options: [{ value: 's', label: 'Seconds' }, { value: 'ms' }], default: 's' });
});
```

- **Inspector tabs** join Console / Network / Performance / Context in the bottom panel (`data-testid="plugin:<plugin>:<id>-tab"`,
  content `…-panel`).
- **Viewer actions** are items in the header's **More** menu (`data-testid="plugin-action:<plugin>:<id>"`); `when` can hide one per replay.
  `placement: 'bar'` makes one an icon button in the header, after the built-in actions, with its label as the tooltip and accessible
  name (phones keep it in More). `icon` is its glyph, a `data:image/svg+xml` URL or an https URL, drawn as an `<img>` (never inlined
  as markup); without one it is a puzzle piece.
- **Viewer panels** open from the **More** menu into a drawer on the right (`slot: 'side'`, `data-testid="plugin-panel:<plugin>:<id>"`).
  This is the extension point for features that need room and live state, such as a comments thread.
- **Timeline tracks** are rows of marks under the seek bar's bars, in the same overlay layer as the comment markers (one 3 px row per
  track, lowest `order` nearest the bar). `markers(ctx)` is called once per open replay and may be async; it returns
  `{ atMs, durationMs?, label, tone? }[]` with `tone` one of `neutral` (default), `info`, `warn`, `error`, `accent`. A `durationMs`
  draws a range. Hover or focus shows the label; a click seeks to `atMs`; a track is one tab stop and the arrow keys walk its marks.
  Markers outside the replay, without a label or a finite `atMs`, and past `MAX_TRACK_MARKERS` (500, exported) are left out with a
  console warning (`data-testid="plugin-track:<plugin>:<id>"`, each mark `plugin-track-marker`).
- **Context sections** draw a block inside the built-in **Context** tab, after its own groups, under a heading with your `title`
  (`data-testid="plugin:<plugin>:<id>-section"`); not a tab of their own. They show even for a replay without context.
- **Settings** are per-person preferences at the bottom of the **More** menu: `type: 'boolean'` is a check item, `type: 'choice'`
  (at least two `options`, `label` defaulting to the value) a labelled group of radio items. Values are kept in the browser's
  localStorage under `replays-plugin:<plugin>:setting:<id>`; a stored value that no longer fits the definition reads as the
  `default`. Read them with `ctx.settings.get(id)` and follow changes with `ctx.settings.onChange((id, value) => …)` (returns the
  unsubscribe function). A plugin only sees its own settings (`data-testid="plugin-setting:<plugin>:<id>"`, choice options
  `…:<id>:<value>`).
- `render(container, context)` draws into the DOM node it is given; return a function to be called on unmount.
- The **context** is `{ replay, theme, basePath, apiUrl(path), getTime(), onTime(listener), seek(ms), notify(message), settings }`. `replay` is the open
  bundle (metadata, steps, console, network, `context`); treat it as read-only. Use `apiUrl('…')` and `fetch` (same origin, the user's
  session) to talk to your own endpoints, which a server plugin adds with `api.onRequest`.
- Theme: read `theme` and the CSS custom properties (`var(--text)`, `var(--surface)`, `var(--accent)` …, the same tokens as
  [branding](extending.md#theming-and-branding)) so a tab follows light/dark and the distribution's colours. A `style` file on the
  client entry is loaded as a stylesheet.
- Registration errors (a bad id, a duplicate, a missing function, an unknown `placement`, an unsafe `icon`, a setting whose `default`
  does not fit its type or options) throw to the entry and are logged with the plugin's name.

- **Generations.** `defineViewerPlugin` stamps the plugin with `VIEWER_API_VERSION` (now `1`, exported from `/viewer`). A viewer of
  another generation does not call it and logs `plugin <name> (<id>) refused: built for viewer API <n>, this viewer provides <m>`.
  A bare function default export (no `defineViewerPlugin`) carries no stamp and is loaded as before.

## The index: summary fields, columns, filters, sections

The index lists summaries (`meta.json`, one per replay), not bundles, so a column or filter can only use what is in the summary.
A plugin puts its own values there on the server, and draws and filters them in the browser:

```ts
// Server (setup(api))
api.summaryFields({
  name: 'build',                 // [a-z][a-z0-9-]{0,39}, unique within the plugin
  version: 1,                    // optional; bump when fields() derives something different
  fields: (bundle) => ({ environment: String(bundle.context?.fields?.environment ?? 'unknown') }),
});
api.indexFilter({
  id: 'environment',
  param: 'x-env',                // GET /api/replays?x-env=production
  match: (summary, value) => summary.ext?.['acme-distro']?.environment === value,
});

// Browser (defineViewerPlugin((api) => …))
api.registerIndexColumn({ id: 'environment', label: 'Environment', render(el, { summary }) {
  el.textContent = String(summary.ext?.['acme-distro']?.environment ?? '');
} });
api.registerIndexFilter({ id: 'environment', label: 'Environment', type: 'choice', param: 'x-env',
  options: [{ value: 'staging', label: 'Staging' }, { value: 'production', label: 'Production' }] });
api.registerIndexSection({ id: 'mine', title: 'For you',
  render(el, { summaries, me }) { el.textContent = `${summaries.length} replays`; },
  update(el, { summaries, me }) { el.textContent = `${summaries.length} replays`; } });
```

**Summary fields** run when a summary is built: at upload, and whenever the store rebuilds one (a missing or older `meta.json`,
a committed sample, or a sidecar built by another set of summary fields: the store records `extVersion`, the registered
`plugin/name@version` list, and rebuilds lazily when it differs). The result, an object of strings, finite numbers, booleans or
`null`, lands in `summary.ext[<plugin name>]`; several sets of one plugin are merged. Limits (`SUMMARY_FIELD_LIMITS` from
`@hazem3500/replays/plugin`): at most 20 keys (`[A-Za-z][A-Za-z0-9_-]{0,39}`) and 2 KB of JSON per plugin; strings are cut to 200
characters. A `fields` that throws or breaks a limit is logged and its set is left out; the upload never fails because of it.
`fields` sees the stored bundle, after the privacy pass. Values are listed to everyone who can see the index, so derive only what the
list may show.

**Index filters** run on the server after the core filters (`q`, `host`, `errors`, `source`, `tag`). `param` must be `x-<name>`
(`^x-[a-z0-9][a-z0-9-]{0,38}$`), so it can never take a core parameter, today's or a later one; a param registered twice is a
start-up `conflict`. A request without the param (or with an empty value) is not filtered; `value` is trimmed and cut to 200
characters; a `match` that throws counts as no match and is logged once per request.

**In the browser**, the same rules as tabs: ids are `[a-z][a-z0-9-]*`, unique per kind within the plugin; `order` sorts (lower first);
a `render` that throws shows an error line in its slot (`data-plugin-error`) and is logged, and the rest of the index carries on.

- **Columns** (`registerIndexColumn({ id, label, order?, render(container, { summary, theme, basePath, apiUrl }) })`) draw a field
  into an inline box on a line under each replay row's meta line, in list rows, grid cards and the phone list
  (`data-testid="plugin-column:<plugin>:<id>"`). Suites are not rows of their own replays and get no columns.
- **Filters** (`registerIndexFilter({ id, label, type, param, options?, order? })`) add a control to the **Filter** menu (and the phone
  sheet, with a removable chip): `switch` sets `<param>=1`, `choice` one of `options` (with "All" first), `text` free text applied on
  Enter or leaving the field (`data-testid="plugin-filter:<plugin>:<id>"`). The browser only sets the query parameter; the server's
  `indexFilter` with the same `param` does the matching. `x-*` parameters in the address are kept and sent even before (or without) the
  entry that registered them. With a plugin filter on, a suite shows only the runs whose replays the server listed.
- **Sections** (`registerIndexSection({ id, title, order?, render, update? })`) are blocks above the list
  (`data-testid="plugin-section:<plugin>:<id>"`). The context is `{ summaries, me?, theme, basePath, apiUrl }`: `summaries` is every replay
  the list shows now (after the filters), `me` the signed-in person from `GET /api/me` once known. When the list changes, `update(container,
  context)` is called if given; otherwise the previous render is cleaned up and `render` runs again.

## Web APIs: routes and middleware

Plugins can serve HTTP with web-standard handlers: a `Request` comes in and a `Response` goes out. The same handler runs on
the built-in Node server and on any fetch host (the TanStack Start mount included). These additions sit alongside
`onRequest`, which keeps working.

```ts
import { definePlugin } from '@hazem3500/replays/plugin';
import { z } from 'zod'; // any Standard Schema library: Zod 4, Valibot, ArkType

export default definePlugin({
  name: 'acme',
  setup(api) {
    api.route({
      method: 'POST',
      path: '/api/plugins/acme/notes/:id',
      body: z.object({ text: z.string().max(500) }),
      handler: ({ params, body, identity }) => Response.json({ id: params.id, by: identity?.id, text: body.text }),
    });
    api.middleware({ phase: 'pre-auth', handle: ({ path }) => (path === '/api/plugins/acme/ping' ? new Response('pong') : undefined) });
  },
});
```

- **`api.route({ method, path, auth?, write?, body?, handler })`**
  - `method` is one method or a list.
  - `path` is matched without the public base and must be `/api/plugins/<plugin name>` or below it. Use `:name` segments, and an optional final `**:name` splat whose value is `params.name`. A trailing slash never matches.
  - `auth: 'required'` (the default) runs after authentication, scopes, CSRF and the `post-auth` hooks, like core routes, and `identity` is set. `auth: 'none'` runs right after the auth adapter's own routes, before authentication, and `identity` is undefined.
  - A route with `write` (the default for any method but GET and HEAD) refuses cross-site browser requests, on `auth: 'none'` routes too, unless a `requestPolicy` allows the origin.
  - With `body`, the JSON body (at most 1 MiB) is read and validated once before the handler runs. Validation issues answer `400` with `path: message` text, and the handler gets the parsed value as `body`. With a body schema the request body has already been consumed; without one, read `request` yourself.
  - Throw `rejectUpload(status, message)` or an error with a 4xx `status` to answer with that status; anything else is a `500`.
- **`api.middleware({ phase, handle })`**
  - It runs for every request in its phase: `pre-auth` after the `onRequest` pre-auth hooks, `post-auth` after the `onRequest` post-auth hooks.
  - Return a `Response` to answer the request, or nothing to let it continue. There is no `next`.
  - Middleware must not read the request body; routes own it.
- **`webRequest`**
  - Upload hooks (`prepareUpload`, `beforeUpload`, `afterUpload`, upload endpoints' `prepare`), context adapters and `identity.resolve` now receive `webRequest`, the same request as a web `Request`, next to the Node `request`.

## Starting the server

`replays serve` reads `replays.config.*` and the environment. To own the entry point:

```ts
import { startServer } from '@hazem3500/replays/server';
const server = await startServer({ handleSignals: true });   // { origin, port, close(), runtime }
```

`createApp` takes `hosts` (`{ 'replays.example.com': { basePath: '' } }`, or the checked form `loadSettings` returns as
`settings.hosts`) and `trustForwardedHost`; `normalizeHosts(hosts, trust)` checks a record the same way at start. With any entry,
responses say `Vary: Host` (docs/operations.md, "Several hosts, one process").

The page itself: `renderIndexHtml(html, { base, branding, beta?, comments?, clientEntries? })` returns the built `index.html` with the
deployment's settings stamped in (base, name, logo, theme tokens, `theme-color` from the `page` token, flags, plugin entries); the
server runs it per request and `buildStatic({ out, base?, env?, cwd?, config?, plugins?, clientDir?, includeRender? })` (the
`replays build-static` command) once, for a CDN. `withBase(html, base, pageBranding?)` is the lower-level stamp. `resolveSettings(options)`
is `createRuntime` without choosing auth (so without its secrets): `{ settings, registry, config }`.

`startServer` options: `env`, `cwd`, `config` (skip discovery), `plugins` (in addition to the config's), `port` (`0` = free port),
`host`, `sampleDir`, `dev`, `handleSignals`, `log`. `SAMPLE_DIR` (or `sampleDir`) replaces the bundled demo replays, for
example with an empty directory. Docker: the image reads the config from its working directory (`/app`), so a distribution
adds its files with `COPY` and sets nothing else.

## Testing a plugin

- **Adapters** run the contract suites the built-in ones pass, from `@hazem3500/replays/server/testing`. They assert with
  `node:assert` and take the runner's `describe` and `it`, so they work under vitest, `node:test`, Jest or Mocha:

  ```ts
  import { describe, it } from 'vitest';            // or: import { describe, it } from 'node:test';
  import { describeAuthAdapter, describeObjectStorage } from '@hazem3500/replays/server/testing';

  // The factory is called once per test and must return an empty store (a fresh bucket or prefix); undefined skips the test.
  describeObjectStorage('acme', () => new AcmeStorage({ bucket: freshBucket() }), { describe, it });

  describeAuthAdapter('acme-sso', {
    create: () => acmeAuth({ audience: 'replays' }),
    accepts: [{ title: 'a signed header', request: { headers: { 'x-acme-jwt': signedFor('ada@example.com') } }, id: 'ada@example.com' }],
    refuses: [{ title: 'no header', request: {} }, { title: 'an expired token', request: () => ({ headers: { 'x-acme-jwt': expired() } }) }],
  }, { describe, it });
  ```

  `describeObjectStorage` covers versions, create-only and `ifVersion` writes (`ObjectExistsError` / `PreconditionFailedError`, both
  409), whole and ranged streams (`404` for a missing object), uploads, prefix and glob listing sorted by key, deletes and key
  validation. `describeAuthAdapter` checks the adapter's shape, the identities it returns for `accepts`, `undefined` for `refuses`,
  and that hostile headers never make `authenticate` throw. `fakeRequest({ method, url, headers, remoteAddress })` builds the request
  an adapter sees.
- Unit-test registration with `resolvePlugins([plugin])` from `@hazem3500/replays/plugin`; it returns what was registered, or throws the `PluginError`.
- Test HTTP behaviour with `createTestClient(handler)` from `@hazem3500/replays/server/testing`. It mounts `createApp(options)` (a
  Node handler) or any `{ fetch(request) }` handler on a loopback port, and returns `{ origin, fetch, close }`, where `fetch('/api/replays')`
  resolves paths against the origin. It's the web-standard twin of `fakeRequest`, so plugin routes and hooks get the same bytes a CLI or
  browser sees:

  ```ts
  const client = await createTestClient(createApp({ ...options, plugins: resolvePluginsSync([plugin]) }));
  expect((await client.fetch('/api/acme/status')).status).toBe(200);
  await client.close();
  ```
- Test behaviour with `startServer({ port: 0, config: { dir, file: {}, plugins: [plugin] } , env: { DATA_DIR, POSTERS_DISABLED: '1', RENDER_DISABLED: '1' } })`.
- `examples/custom-distro/e2e/smoke.spec.ts` shows a browser-level check of each extension point.

## Host editing write policy

Use `defineConfig({ beta: { editor: true }, editing: { enabled: false } })` for a host that plays saved edits
without accepting new ones. `editing.enabled` defaults to `true`; `beta.editor` remains the outer gate, so enabling
writes never enables the beta feature. This host policy is independent of malleable plugin permissions and approvals.

`EDITING_ENABLED` overrides the config value. It accepts `true`/`1`/`yes`/`on` and `false`/`0`/`no`/`off`
(case insensitive); an unset or blank value uses the config. Config values must be booleans. Invalid shapes, unknown
`editing` keys, non-boolean values and invalid environment values fail startup, even if the environment overrides the file.

With the beta editor on and writes disabled:

- Edit links and actions disappear, and `/r/<id>/edit` opens normal playback without loading the editor.
  The URL drops `/edit` with history replacement while keeping its query and fragment.
- `GET` and `HEAD /api/replays/<id>/edits` keep their saved data, ETags and `304` revalidation.
- `PUT` for an existing replay returns `403` with `{ "error": "editing is turned off" }` before checking `If-Match`
  or parsing the body. Missing replays still return `404`.
- Saved trims, cuts and effects still apply to playback and video exports, including the edit version in render cache keys.

`GET /api/config` advertises the effective write capability as `editing: { enabled: boolean }` (the beta flag AND
the write policy). Served pages carry the same value in `<meta name="app-editing" content="on|off">`.
With `beta.editor` off, the edits API remains `404`, playback and exports ignore stored edits, and editing stays unavailable.

## Trusted browser intake and upload aliases

A host plugin can declare a browser intake policy during setup. Configure explicit trusted origins in the host;
replays has no CORS origins or alternate upload endpoints by default.

```ts
api.requestPolicy({
  path: '/api/replays',
  methods: ['POST'],
  origins: ['https://app.example.com'],
  headers: ['content-type'],
  credentials: true,
});

api.uploadEndpoint({
  path: '/api/foreign-recordings',
  prepare: ({ body, identity, request }) => translateForeignRecording(body, identity, request.url),
});
```

`RequestPolicy` and `UploadEndpoint` are exported types from `@hazem3500/replays/plugin`. These are trusted server
registrations, never values accepted from an incoming request. Policy paths are exact canonical application paths (2 to 8 segments, such as `/api/replays` or an upload endpoint's) without
query strings, patterns or the deployment base prefix. Methods are uppercase `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, or
`DELETE`; origins are serialized HTTP(S) origins without paths, trailing slashes, credentials or wildcards. Header names
are case insensitive explicit HTTP tokens, never `*`. Overlapping path/method policies are rejected even across plugins;
registrations are copied and frozen so selection is stable after setup.

For the example policy, only `POST /api/replays` from the named origin gets `Access-Control-Allow-Origin` and
`Access-Control-Allow-Credentials: true`. `GET` gets no CORS permission. An OPTIONS preflight must name an allowed
origin, requested method and subset of the allowed request headers. An accepted preflight returns an empty `204`
before auth, request hooks or data access; a denied preflight returns `403`. Both vary on `Origin`,
`Access-Control-Request-Method` and `Access-Control-Request-Headers`. Actual responses vary on `Origin`, preserving
other core or host `Vary` fields. Allowed actual requests retain CORS headers on authentication, validation, duplicate,
host-policy and server errors.

**Actual data requests always authenticate**: with the configured auth adapter, or with an upload endpoint's own `authenticate` on that endpoint's path. Only an exact path/method/origin match exempts that
request from the core cross-site CSRF rejection. Unlisted cross-site origins on a configured mutating route are refused.
Same-origin browser requests retain their normal CSRF behavior. Other routes keep normal CSRF checks. Clients without Origin use the existing auth and CSRF behavior; a missing Origin never
grants an exception. `credentials: true` is browser permission to send credentials, not an identity or an auth bypass.

An upload endpoint is a distinct lowercase path of 2 to 8 segments ([details](#custom-upload-endpoints)); core route prefixes are
reserved. It accepts POST through normal auth (or its own `authenticate`), CSRF and post-auth request hooks. It implies no CORS permission. The optional endpoint `prepare` uses `PrepareUploadHook` and runs
on the parsed raw JSON before global `prepareUpload` hooks. Both see the original request, including its URL and base
prefix. Then the same context adapters, source resolution, schema/bundle validation, sanitizer, `beforeUpload`, immutable
storage/duplicate checks and `afterUpload` hooks run as for the canonical upload endpoint. JSON errors are identical; the
body limit is the endpoint's `maxBytes` (25 MiB by default). Prepared bodies remain untrusted.

Backend identities are a host authentication concern: verify the service identity and confine it in the auth adapter,
most simply by returning it with `capabilities` ([below](#write-only-identities)). Built-in plugins may answer their routes before a host post-auth
hook runs, so auth is the enforcement boundary for a universal restriction. A post-auth hook can additionally restrict
host requests by **both** canonical `path` and request method:

```ts
api.onRequest(({ identity, path, request, response }) => {
  if (identity?.id === forwardingServiceId &&
      !(path === '/api/foreign-recordings' && request.method === 'POST')) {
    response.writeHead(403);
    response.end('service identity restricted');
    return true;
  }
});
```

Use the host's verified stable identity, not an unverified email/header. Neither alias registration nor request policy authorizes a service identity to browse other authenticated routes.
Mounted paths (`/tools/replays/api/…`) and proxy-stripped paths resolve to the same canonical registration.

### Browser sign-in recovery

An auth adapter can declare `signIn: { path: '/api/sign-in' }`. Core then serves an authenticated GET return endpoint and stamps the viewer with its URL. `/auth/<name>` paths also work; paths are canonical and omit the deployment base. The IAP plugin opts in by default and accepts `signIn: false` or a custom path. No audience or key material reaches the browser.

For a public CDN viewer, set `signIn: { path: '/api/sign-in' }` in `defineConfig` too: `build-static` stamps this explicit value without instantiating an auth adapter or needing its secrets. The same configuration must reach the API server. `signIn: false` overrides adapter metadata. Publish the sign-in endpoint behind the same authentication front door as the API.

When a page-data read fails, the viewer probes `/api/me` with manual redirects and XHR headers. A proxy redirect or 401 offers Sign in; an unreachable API remains a network error. An observed index, replay, suite or editor load navigates through the return endpoint at most once per tab per minute. Unavailable sessionStorage leaves a manual link. Prefetches, uploads, mutations and internal rendering never navigate. The endpoint accepts a normalized same-origin `next` path with query and hash, rejects open redirects and refuses to bounce into itself or machine endpoints. Ordinary API failures remain HTTP failures.

```ts
// Host configuration, also used by replays build-static:
defineConfig({ signIn: { path: '/api/sign-in' }, plugins: [iap({ /* deployment options */ })] });
// A custom adapter's optional declaration:
const auth: AuthAdapter = { name: 'proxy', signIn: { path: '/auth/return' }, authenticate };
```

`SignInConfig` is exported as a type from `/server`. Existing adapters remain unchanged unless they opt in.

## Unified slots

The viewer entry exports `SlotRegistry`, `SLOT_NAMES`, and the types `SlotDescriptor<C, R>`,
`SlotConfiguration` and `SlotMountContext<C>`. A descriptor is
`{ id, order, when?: (context) => boolean, render: (context) => result }`.
Use `core:<id>` for built-ins and `plugin:<owner>:<id>` for plugin items. Numeric order is ascending;
built-ins use gaps (100, 200, …). Equal orders retain registration order. Resolution is pure: it
filters and sorts without mutating descriptors or calling `render`.

Host browser entries can call `api.configureSlot('viewer.inspector.tabs', {
  order: ['plugin:acme:build', 'core:console'], hide: ['core:performance'],
})` and `api.registerSlotItem(slot, descriptor)`. Explicitly ordered ids precede unspecified items;
`hide` removes items. Configuration replaces the previous configuration for that slot. Unknown ids
are retained so configuration can precede lazy registration. Locked surfaces reject configuration
before it changes anything. Hosts can lock legacy ids such as `inspector:context`, or any slot/item
pair such as `index.filters/core:owner`. Sandboxed user plugins cannot configure host slots.

Initial slots: `viewer.inspector.tabs`, `viewer.panels.side`, `viewer.actions`,
`viewer.scrubber.tracks`, `viewer.context.sections`, `index.row.columns`, `index.filters`,
`index.sections`, `settings.sections`. Distributions may define additional slot names. A view
supplies its built-ins as the same descriptor list; it must render the resolved list to support
core item configuration. The registry does not discover JSX automatically.

Existing `register*` methods remain supported. Their DOM descriptors receive
`{ container, context }`; action descriptors receive the viewer context, track descriptors return
markers, and filter/settings descriptors return the definition for the host renderer. Registry
snapshots continue to expose the original metadata. Slot containers use `data-slot="<slot>"` and
items use `data-slot-item="<namespaced id>"`; these two attributes are public hooks for host CSS.
Other DOM structure and classes remain private.

Sandboxed plugin manifests now accept the same boolean/choice setting definition as
`registerSetting`. Their `ctx.settings.get(id)` / `set(id, value)` are asynchronous and persisted
per person and plugin through the malleable API. Host `ViewerPluginContext.settings` retains its
synchronous `get` and `onChange` contract. Internal Settings renderers use the combined registry
settings list, `readSetting`, `subscribeSettings` and `writeSettingValue` (awaitable, reports failed
saves); `writeSetting` remains the existing fire-and-forget menu helper.

## Check a plugin from the CLI

`replays plugin check ./plugin.mjs --replay ./fixture.json` runs server setup, fixture before-upload
hooks, summary derivation, and registered auth/storage contracts. `--config ./replays.config.ts`
loads dependencies and host configuration. Storage contracts use disposable `_plugin-check/…`
namespaces and clean them up; configure adapters for a test backend. Use `--request request.json` (method, URL and headers) to supply an accepted auth request. Auth contracts report a missing acceptance fixture rather than silently skipping it.

`replays plugin check ./entry.mjs --kind browser --cdp http://127.0.0.1:9222` checks a browser entry.
`replays plugin check ./example.replays-plugin.json` validates and runs each declared contribution
in the real sandbox. By default these connect to an existing browser. Use `--headless` to launch a fresh local Chromium (install it separately with `pnpm exec playwright install --with-deps chromium`); this is suitable for CI or an isolated Boat box. The
CDP browser must be able to reach the CLI's loopback check server (run them on the same host, or
forward both loopback endpoints). Each check creates and closes one browser context. External
requests are blocked; fixture comments/downloads are printed. `--out ./shots` captures at most
eight contribution screenshots. Output includes registrations, fixture results and errors;
failures exit 1, argument errors exit 2. The default fixture is a small valid in-memory replay.

The viewer entry now exports `ViewerRegistry` for hosts and harnesses needing an isolated registry;
its documented `apiFor`, `configureSlot`, `registerSlotItem`, `resolveSlot`, `getSnapshot` and
subscription lifecycle share the API used by the running app. The application singleton remains
internal. These additions keep plugin and viewer API generation 1.


## Plugin pages

Host browser entries register one page with `api.registerPluginPage({ title, loader?, render })`.
The owner is always `api.pluginName`; sandboxed user plugins cannot register routes. The route is
`/p/<plugin>/<path>` and preserves plugin search parameters. The optional loader receives
`PluginPageLoadContext` (`path`, `search`, `signal`), and may return a value or promise. The DOM
renderer receives `PluginPageContext`: those fields, the loader's `data`, theme/base-path/API URL
helpers and `navigate(path, search?)`. Return a cleanup function as with tabs.

Navigation stays under the plugin's root: schemes, other plugins, backslashes and dot traversal
are rejected. The route waits for browser plugin loading before deciding a page is missing and
subscribes to later registrations. Page registrations participate in plugin removal, reset and
failed-hot-reload rollback. Page title, loader and DOM render are the public surface; head metadata
and automatic navigation entries are not provided yet. The TanStack route integration is owned
by the router increment.

Host policy additionally accepts `workspaceRoles`, exact `allow`/`deny` selectors by id or policy
hash, and validated `watchdog` limits. `Identity.roles` is an optional trusted claim from the auth
adapter. See [malleability.md](malleability.md#host-admission-workspace-review-and-runtime-budgets)
for defaults, enforcement and the remaining requirements before default-on.

Additional published slot names used by the redesign are `index.chips`, `inspector.network.columns`,
`performance.vitals`, `editor.topbar.actions`, `editor.inspector.sections`, `editor.tools`,
`editor.timeline.lanes` and `export.formats`. All legacy `register*` contributions receive slot order
`1000 + (definition.order ?? 0)` so default plugin contributions remain after core items; their
snapshot definition order retains its original value. Generic descriptors use their numeric
order directly.

## Custom upload endpoints

`api.uploadEndpoint` registers a `POST` route into the same core upload pipeline as `POST /api/replays`. A host can
build a backend forwarder, a service-to-service intake or a public app-key ingest on it without the core knowing about
any of them. Replays enables none by default.

```ts
api.uploadEndpoint({
  path: '/api/ingest/v1/recordings',
  authenticate: (request) => appForKey(request.headers['x-app-key']),
  maxBytes: ({ identity }) => limitFor(identity),
  rateLimit: ({ identity }) => (bucket.take(identity.id) ? undefined : { retryAfter: bucket.wait(identity.id) }),
  prepare: ({ body }) => unwrapEnvelope(body),
  normalize: ({ bundle, identity }) => ({ ...bundle, meta: { ...bundle.meta, id: serverId(), source: 'human' } }),
  receipt: ({ bundle, replayUrl }) => ({ id: bundle.meta.id, reference: shortReference(bundle), replayUrl }),
});
```

| Option | Contract |
| --- | --- |
| `path` | Canonical, without the deployment base prefix: 2 to 8 lowercase `[a-z0-9][a-z0-9-]*` segments, such as `/api/customer-recordings` or `/backoffice/api/customer-recordings`. Paths under `/api/replays`, `/api/suites`, `/api/me`, `/api/config`, `/api/cli`, `/api/malleable`, `/api/agent-*`, `/api/sign-in`, `/auth`, `/internal`, `/_plugins`, `/assets` and `/r`, and `/healthz` itself, are reserved |
| `prepare({ body, identity, request })` | The raw parsed body, before global `prepareUpload` hooks and any validation. Return the replay envelope (unwrap a forwarding wrapper, translate a foreign shape) |
| `authenticate(request)` | This path's own credential check, used **instead of** the deployment's auth adapter for every method on the path. Return an `Identity`, or nothing for `401 credentials required`; throw an `HttpError` (such as `403` for a disabled app) or `tooManyRequests(seconds)` for anything else. The identity is always confined to `POST` on this path (see [write-only identities](#write-only-identities)) |
| `maxBytes` | A positive byte count or `({ identity, request, path }) => number`; default 25 MiB. A larger `Content-Length` answers `413` before the body is read; the stream is cut off at the cap; a gzip body is capped again once decompressed |
| `rateLimit({ identity, request, path })` | After authentication, before the body is read. Return `{ retryAfter, message? }` (seconds) to answer `429` with `Retry-After`; nothing to continue |
| `normalize({ bundle, identity, request, path })` | On the validated bundle, before the global `normalizeUpload` hooks. Return a replacement or mutate it: force the id, title, profile or source; drop client people, suite membership or context; add derived context and source links |
| `receipt({ bundle, identity, request, path, url, replayUrl })` | The `201` JSON body; default `{ id, url }`. `url` is the base-prefixed path, and `replayUrl` is absolute when the deployment's public origin is set. Both stay behind the viewer's normal auth |

### The pipeline

For a `POST` to an endpoint the order is:

1. request policy (CORS, preflight)
2. `pre-auth` hooks
3. the adapter's own routes
4. `authenticate` (or the adapter), then `api.identity` resolvers
5. the capability and scope check, then CSRF, application authorization and `post-auth` hooks
6. `rateLimit`, then `maxBytes` (declared length, stream, decompressed size)
7. `prepare`, then `prepareUpload`, context adapters, source resolution and the stored and context schemas
8. `normalize`, then `normalizeUpload`, then the same validation again
9. **the privacy pass**, then `beforeUpload`, the profile and people checks, storage, retention and `afterUpload`
10. `receipt`

The privacy pass (the default redaction plus the deployment's and plugins' rules) always runs after every
normalization step and cannot be turned off from a hook. Profiles, retention rules and Keep apply to endpoint uploads
as to any other.

### Errors

An endpoint answers errors exactly like `POST /api/replays`: a `text/plain` message with the status.

| Case | Status |
| --- | --- |
| invalid envelope or bundle (the schema or a validator) | `400` with the validator's message, such as `replay.meta.url must be a string` |
| body is not JSON | `400 body is not valid JSON` |
| corrupt gzip stream | `400 body is not valid gzip` |
| `Content-Encoding` other than `gzip` or `identity` | `415 unsupported content-encoding: <value>` |
| over `maxBytes` | `413 upload is larger than <size>`, or `… once decompressed` |
| `HttpError(status, message, { headers })`, `tooManyRequests(seconds)` | that status and message, with its headers (`Retry-After`) |

`Content-Type` is not inspected, as on `POST /api/replays`. A gzip body labelled `text/plain` is accepted if it
decompresses to valid JSON. A host that wants a `415` for other content types throws `new HttpError(415, …)` from
`authenticate` or a request hook. Server errors (`5xx`) answer `{ "error": "internal error" }` and never expose a
message.

### Write-only identities

`Identity.capabilities` confines an identity to exact routes: `{ routes: [{ method: 'POST', path: '/api/forwarded' }] }`,
as canonical paths without the base prefix. Any other request answers `403 identity cannot access this route`. The
check runs right after authentication and the identity resolvers, before CSRF, application authorization, `post-auth`
hooks, plugin routes and core dispatch, so no route can be reached around it. Any adapter can return capabilities;
an endpoint's own `authenticate` always gets `[{ method: 'POST', path }]`. That one identity therefore cannot read,
list, edit, delete, comment on, keep or export a replay, or reach the agent bridge.

An upload-only token (`authScopes: ['replays:upload']`) may post to `/api/replays` and to every registered upload
endpoint, as well as the video `PUT` and `GET /api/cli/auth/status` it could use before.

### Browser uploads and the gateway

An endpoint implies no CORS. For pages on other origins, register a `requestPolicy` for the endpoint path with the
exact origins and headers, for example
`{ path, methods: ['POST'], origins, headers: ['content-type', 'content-encoding', 'x-app-key'] }` without
`credentials`. Preflights are answered before `authenticate`, so a preflight never needs a key. Where several
callers each have their own origins, register the union and check the caller's own list inside `authenticate`, where
the key is known.

An endpoint with its own `authenticate` usually sits outside the staff gateway. Exempt **exactly** that path (with the
deployment's base prefix) from IAP or the identity-aware proxy, and nothing else: every other route still needs the
staff identity, and the endpoint's identity cannot reach them anyway.

[`examples/app-key-ingest`](../examples/app-key-ingest/README.md) is a complete public app-key ingest built only from these
hooks. It has per-app keys with rotation, origin lists, per-key and per-IP limits, a per-app body cap and retention,
server-chosen ids and an audit line per request. Its counters are per process, so with several replicas use a
shared store.

# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project aims to follow [Semantic Versioning](https://semver.org/) once it reaches 1.0.

## [Unreleased]

### Security

- Error responses no longer pass on what the server didn't decide itself. A storage provider's status
  (`GcsError`/`S3Error` 403/404/429) and a corrupt stored file are now a generic `500 internal error`, not a 4xx
  carrying the provider's or the parser's message. Storage `NotFoundError`/`ObjectExistsError`/`PreconditionFailedError`
  keep their status (404/409) but no longer name the object key. Malformed JSON request bodies are `400 body is not
  valid JSON` everywhere. `rejectUpload()` and the documented 4xx answers are unchanged.

- Add adapter-owned/configurable sign-in recovery for public CDN viewers: safe authenticated return endpoints, page-load recovery and a bounded automatic attempt with manual fallback.

### Added

- Comparing recordings is a mode of the replay viewer: the "Compare" button in the viewer's top bar adds recordings to
  `/r/<id>?with=<id>,<id>&layout=grid|spotlight&focus=<id>`, and a suite opens compared (Grid, or Spotlight on the run
  its link names). Single, Grid and Spotlight share one clock and the viewer's
  own transport, shortcuts and inspector, scoped to the focused recording; tiles glide between layouts without
  remounting their players. A suite with two or more recordings opens this way with its runs as the recordings, and
  its sidebar moves the focus. The Performance tab compares the recordings' worst paints, tasks and interactions.
  `scripts/demo-comparison-seed.mjs` adds demo suites to compare.
- Recorder HTTP upload: `createRecorder({ upload: { url, headers?, body?, timeoutMs?, credentials? } })` and `createHttpUpload(options)`
  from `/recorder` post gzip JSON to any endpoint and return `{ replayId, reference, url }`. `IssueUploadError` gains `retryable`
  (network errors, timeouts, 408, 429, 5xx) and `retryAfterMs` (from `Retry-After`).

- Source-provider marks: `SourceProvider.mark` names a built-in monochrome mark (`github`, `gitlab`, `slack`, `linear`,
  `jira`, `notion`, `link`); built-ins carry theirs and a config provider named like a mark gets it. Index rows show the
  mark beside the source label; on phones one icon chip opens a sheet of every source instead of linking out.
- **Custom upload endpoints** ([docs/extension-api.md](docs/extension-api.md#custom-upload-endpoints)), additive in plugin API 1:
  - `api.uploadEndpoint` gains `authenticate` (its own credentials instead of the auth adapter, identity confined to the endpoint),
    `maxBytes` (a number or per-identity function, checked against `Content-Length`, the stream and the gunzipped size),
    `rateLimit` (`{ retryAfter }` answers `429` with `Retry-After`), `normalize` and `receipt`. Paths may have 2 to 8 segments
    and any prefix (`/backoffice/api/customer-recordings`); `requestPolicy` accepts the same paths.
  - `api.normalizeUpload(hook)` normalizes every validated upload; the result is validated again and the privacy pass always
    runs after it.
  - `Identity.capabilities` (`{ routes: [{ method, path }] }`) confines an identity to exact routes, checked once right after
    authentication. `replays:upload` tokens may also post to registered upload endpoints.
  - `/plugin` exports `HttpError` (status, message, optional headers) and `tooManyRequests(seconds, message?)`.
  - `examples/app-key-ingest`: a public app-key ingest (keys with rotation, origins, limits, retention) built only from these hooks.

- Plugin Web APIs, additive in plugin API generation 1 ([docs/extension-api.md](docs/extension-api.md#web-apis-routes-and-middleware)):
  - `api.route(...)`: web-standard handlers under `/api/plugins/<plugin>`, with `auth`, `write` and a Standard Schema `body`
  - `api.middleware(...)`: `pre-auth`/`post-auth` interceptors that return a `Response` or nothing
  - `webRequest` next to `request` in upload hooks, context adapters and `identity.resolve`
- `PATCH /api/replays/<id>/meta` renames, retags or sets the purpose of a replay; `DELETE /api/replays/<id>` deletes it softly
  (restorable with `POST /api/replays/<id>/restore` for 7 days, refused with `409` while kept). Bodies are validated against
  shared schemas (`400` with the issues). Uploaded bundles stay immutable: changes live in `<id>/overrides.json` and
  `<id>/trash.json`, and the list, summaries and retention read them.
- `createTestClient(handler)` in `@hazem3500/replays/server/testing`: a fetch-style client over a loopback port, for `createApp()`
  or any `{ fetch }` handler ([docs/extension-api.md](docs/extension-api.md#testing-a-plugin)).
- An HTTP contract suite (`test/contract/`) pins the public API's statuses, headers and bodies as explicit golden responses. Each mount of
  the app (the Node handler today, a web `fetch` handler and a CI-only TanStack Start mount later) has to match it.
- Capture pacing: optional `CaptureArgs.stepPauseMs`, config `capture.stepPauseMs`, and CLI `--step-pause`
  (0–10000ms after non-wait actions; default 0 for compatibility, set 1200 for demonstration captures).
  Built-in drivers type at 80ms/character, selector-derived labels omit typed values, and unlabelled waits
  no longer add rail steps. Full privacy masking remains unchanged.
- Shared playback/export speeds including 0.25× across render start/status/download/cancel and frame math.
  Captions hold through legacy pacing waits and repeated labels while numbering follows the active rail;
  exports redraw on number changes. Skip inactive uses a 4000ms threshold, 800ms lead and 16× speed.

- **First-party plugins** `@hazem3500/replays/plugins/iap` and `@hazem3500/replays/plugins/gcs`
  ([docs/extension-api.md](docs/extension-api.md#first-party-plugins)):
  - `iap({ audience, domains, serviceAccounts, devFallback })`: the `iap` auth adapter verifies `x-goog-iap-jwt-assertion` (ES256,
    Google's JWKS cached for an hour, issuer `https://cloud.google.com/iap`, exact audience, `iat` required, 30 s leeway) and lets in
    the listed email domains and exact service accounts; a non-service-account entry stops the server. Env: `IAP_JWT_AUDIENCE`,
    `IAP_ALLOWED_DOMAINS`, `IAP_SERVICE_ACCOUNTS`.
  - `gcs({ bucket, prefix })`: the `gcs` storage backend over the Cloud Storage JSON API with `fetch`, no SDK: create-only writes with
    `ifGenerationMatch=0`, generations as versions, resumable uploads above 8 MB, `matchGlob` listing, tokens from the metadata server
    or `GOOGLE_OAUTH_ACCESS_TOKEN`, `STORAGE_EMULATOR_HOST` / `GCS_API_ENDPOINT`. Env: `GCS_BUCKET`, `GCS_PREFIX`. It passes the storage
    contract suite against an in-process fake of the API.
- **Adapter kit** for storage and auth adapters written outside this repository:
  - `ObjectStorage.kind` is an open string (the built-ins stay `fs`, `s3`, `memory`), and a backend sets `listCacheMs` to get the store's
    listing cache (S3 sets 5000, as before).
  - `/server` exports `ObjectExistsError`, `PreconditionFailedError`, `NotFoundError`, `assertKey` and `globToRegExp`, and
    `verifyJwt({ token, jwksUrl | jwks, issuer, audience, algorithms, leewaySec, requireIat })`.
  - `@hazem3500/replays/server/testing`: `describeObjectStorage(name, factory, { describe, it })` and `describeAuthAdapter(name,
    contract, { describe, it })`, the contract suites the built-in adapters pass, plus `fakeRequest`. They assert with `node:assert`, so
    any runner works.
  - `requires` on a plugin: a semver range over the package version (`>=0.4 <0.6`, `^0.4.1`); outside it the server refuses the plugin
    at start (`PluginError` `version-range`).
  - `VIEWER_API_VERSION` (`1`, from `/viewer`): `defineViewerPlugin` stamps it, and the viewer refuses an entry of another generation
    with a console error.
- **A base path per host, a static build, and theme-color from the branding.** `hosts: { 'replays.example.com': { basePath: '/' } }`
  in the config serves one process at a different base per request `Host` (other hosts keep `basePath`), with `Vary: Host` on every
  response and `trustForwardedHost` / `TRUST_FORWARDED_HOST` for a gateway that rewrites `Host`; host names are checked at start.
  `replays build-static --out <dir> [--base /] [--config path]` copies the built viewer with base, name, logo, theme tokens, flags and
  plugin entries stamped into `index.html`, the same function the server runs per request (`renderIndexHtml`), for hosting the viewer
  on a CDN in front of the API (docs/operations.md). `<meta name="theme-color">` now follows the theme's `page` token per scheme.
  New in `@hazem3500/replays/server`: `buildStatic`, `renderIndexHtml`, `withBase`, `normalizeHosts`, `resolveSettings`.
- **Redaction rules.** A deployment adds its own rules to the sanitiser: extra `headers` to drop, `queryParams` to redact,
  `jsonKeys` whose values are redacted in console arguments, free-`text` patterns, and `maskSelectors` whose text the recorder masks
  (rrweb `maskTextSelector`). Set them with the config key `redaction` (JSON configs write regexes as `"/.../flags"` strings) or
  `api.redaction(rules)` in plugins; rules add up and can never weaken the defaults. They apply in the capture CLI, which now reads
  the deployment's config (`--config <file>`, `REPLAYS_CONFIG` or `replays.config.*` in the working directory), and again in the
  server's privacy pass on upload. New exports: `assertRedactionRules` and the `RedactionRules` types from `/plugin` and `/capture`;
  optional `redaction` arguments on `sanitizeReplayBundle`, `sanitizeHar`, `sanitizeUrl`, `networkEntries`, `normalizeConsole` and
  `RecorderSession.start`; `AppOptions.redaction`. See [docs/extending.md](docs/extending.md#redaction-rules).
- **`replays migrate`.** Copies a store into another and converts every replay on the way: `--from` / `--to` take `fs:<dir>`,
  `s3:<bucket>[/prefix]` or a storage backend a config plugin registers, `--translate` a module whose default export converts a
  raw `replay.json` (and an optional `translateSuite` for suites). Each bundle is validated with the core validator and gets the
  upload privacy pass; invalid ones are reported and nothing of their prefix is written. Sidecars (comments, edits, keep markers,
  posters, videos), suites and plugin data are copied; writes are create-only, so a second run converts nothing and an
  interrupted one resumes. `--dry-run`, `--report out.json`, and `--compare` for the list-summary diff between two stores. The
  same as `migrateStore()` and `compareStores()` from `@hazem3500/replays/server`, and a translation for the older downstream
  format in `examples/migrate/`. See [docs/operations.md](docs/operations.md#converting-stored-replays).
- **Host policy for user plugins, and the upgrade contract (beta.malleable).** A `malleable` config block lets a deployment narrow
  what sandboxed user plugins may do: `scopes` (where a plugin may be kept), `capabilities` (`allow` / `ask` / `deny` per capability;
  write capabilities can only be `ask` or `deny`, checked at start) and `lockedSurfaces`. `malleable.enabled` is accepted as the same
  switch as `beta.malleable` (both keep working; if both are set they must agree). The server refuses to keep a plugin that declares a
  denied capability or targets a disabled scope, the broker fails denied capabilities with `permission-denied`, and the workshop shows
  the policy. New `distribution: { name, version }` config key. `GET /api/config` now includes `core`, `distribution` and (with the
  feature on) `malleable`. Kept plugin versions record `manifest.targets: { core, distribution }` (additive to
  `plugin-manifest.schema.json`); the viewer records load health per (core, distribution) in localStorage and shows a quiet "Review
  plugins" notice for a plugin that fails after the versions changed, without disabling or changing anything. `get_plugin_api` now
  returns the theme tokens, the policy, the versions and the surfaces in the viewer.

- **Render pipeline hooks** ([docs/extension-api.md](docs/extension-api.md#render-pipeline-hooks)). `api.render({ posterAt?, beforeRender?,
  afterRender? })`: `posterAt(bundle, { purpose })` picks the poster's moment (the first hook in plugin order that returns a time wins,
  then the purpose's `poster` setting, which is now the built-in last step of the same chain, then the default); `beforeRender(job)`
  refuses a render (`false`; a refused export answers `{ status: 'refused', error }`) or changes a video export's `speed`, `captions` or
  `skipInactive`; `afterRender(job, { file, key, contentType, bytes })` runs after each stored video, poster, opening still and preview,
  and its errors never fail the render. Hooks see a small job object (`id`, `replayId`, `kind`, `options`, `identity?`). A poster
  taken at a non-default moment is stored as `poster.v2-<moment>.jpg`, so a changed choice is remade instead of served stale.
- **Purposes and retention rules** ([docs/extension-api.md](docs/extension-api.md#purposes-and-retention)). A deployment can say why
  replays are recorded: `purposes: [{ id, label, order?, retentionDays?, viewer?, poster? }]` in the config file, or
  `api.purpose({ …, infer? })` from a plugin (the core defines none). Uploads may carry `meta.purpose` (checked against the
  registered ids; refused when none are registered), `--purpose <id>` on `capture`, `upload` and `import`, and a picker in the
  upload dialog. Summaries gain `purpose` and `purposeInferred` (`SUMMARY_VERSION` 7, plus `suiteRun`); `GET /api/replays?purpose=`,
  `purposes` in `/api/config`, and "All · <purpose>" tabs with counts on the index. Per purpose: a retention window
  (`RETENTION_PURPOSE_<ID>_DAYS` overrides; an inferred purpose never makes a replay permanent), viewer defaults (open at the start
  or just before the first error, the panel open or folded, captions) and the poster moment (`middle-step`, `first-error`,
  `last-step`). `api.retention({ days(summary) })` adds rules that are not about purpose: the shortest window wins, `0` means no
  limit, Keep still overrides. `/server` exports `createPurposeCatalog` and `PurposeCatalog`.
- **Index slots for plugins** ([docs/extension-api.md](docs/extension-api.md#the-index-summary-fields-columns-filters-sections)):
  `api.summaryFields({ name, version?, fields(bundle) })` derives small values into `summary.ext[<plugin>]` at upload and whenever a
  summary is rebuilt (capped: 20 keys, strings cut to 200 characters, 2 KB per plugin, `SUMMARY_FIELD_LIMITS`; a failing set is logged
  and left out; stored summaries built by other sets are rebuilt). `api.indexFilter({ id, param, match })` filters `GET /api/replays`
  on the server by an `x-*` query parameter, listed in `GET /api/config` as `indexFilters`. In the browser,
  `registerIndexColumn`, `registerIndexFilter` (`switch`, `choice` or `text` in the filter menu and the phone sheet) and
  `registerIndexSection` (a block above the list, re-drawn or `update`d when the list changes, with `summaries` and `me`).
  The custom-distro example uses all five.
- **People and identity resolvers** ([docs/extension-api.md](docs/extension-api.md#people-and-identity)). `meta.people` and suite
  `people` (at most 10 `{ role, email?, name?, handles? }`, size-capped, documented in `docs/formats/replay.schema.json`), repeatable
  `--person role:email[:handle=value]` on `replays capture` and `replays import`, `?person=` on `POST /api/replays/import`, and a
  people-only suite re-registration that replaces them. `api.people({ roles, validate, handles, avatarUrl, profileUrl })` (one per
  deployment) sets role priority, refuses people with a `400` naming them, and resolves https avatar and profile links in summaries.
  `?for=me` on `GET /api/replays` and `GET /api/suites` matches the signed-in email and linked `handle.<id>=` values and returns the
  best role as `reason`; `GET /api/me` adds the people config. `api.identity({ resolve })` enriches the signed-in identity after auth
  (it cannot change `id`). The index shows an avatar stack with a person card on rows that have people, and a For me switch with
  fields for the linkable handles (kept in localStorage). `assertReplayPeople`, `parsePeopleFlags` and `personMatch` are exported from
  `/capture`.
- **Viewer slots for client plugins.** `registerViewerAction` takes `placement: 'bar'` (an icon button in the viewer header) and an
  `icon`; `registerTimelineTrack({ id, label, markers(ctx) })` draws marks or ranges under the seek bar (hover shows the label, a click
  seeks; at most `MAX_TRACK_MARKERS`, 500, per track); `registerContextSection` draws a block inside the Context tab; `registerSetting`
  adds a boolean or choice setting to the More menu, stored per person in the browser and read with the new `ctx.settings`. Context
  schemas can use `x-replays-widget: "signals"` (tri-state flags, with unknown distinct from disabled), `x-replays-group` and
  `x-replays-order`. See [docs/extension-api.md](docs/extension-api.md).
- **Source provider looks and attributes.** A source provider may declare an `icon` (a `data:image/svg+xml` or https URL, always drawn
  as an image) and a `noun`, shown on the topbar chip, in the Context tab and on index rows; `resolve` may return `attrs`, kept on the
  stored source and, capped, in the index summary (`SUMMARY_VERSION` 7: older sidecars are rebuilt). See
  [docs/extending.md](docs/extending.md#source-link-providers).
- **Host editing write policy.** `editing.enabled` / `EDITING_ENABLED` can disable new edits while preserving saved-edit
  reads, playback and video exports. Edit links and routes follow the policy; saves return `403` before precondition or body
  parsing, and `/api/config` advertises the effective capability. The beta editor flag remains the outer feature gate.

- Trusted host plugins can register exact route/method/origin request policies with credentialed CORS and validated
  preflight handling before authentication. Actual requests retain auth and get only a matching CSRF exception.
- Host-defined POST upload endpoint aliases with optional raw-body preparation reuse validation, privacy checks,
  immutable storage and all normal upload hooks. No extra endpoint or browser origin is enabled by default.
- **Malleable viewer (beta, off by default).** An in-app plugin workshop: write a tab, side panel or More-menu action in an
  editable source view and it hot-loads into the running viewer. Plugins run in a sandboxed frame (opaque origin, CSP forbidding
  every outgoing request, a capability broker; `comments:write` and `export:download` ask the person each time), are stored per user
  or workspace as a full version history (diff, revert, export/import as `*.replays-plugin.json`), and nothing is stored without an
  approval token bound to the exact content the person approved. An agent bridge exposes live state and the plugin API as WebMCP tools
  in the page (`document.modelContext`, with a stand-in where the browser has none) and through `replays mcp`, an MCP server over
  stdio; an agent can install a draft and ask the person to keep it, but cannot save. Enable with `REPLAYS_BETA_MALLEABLE=true` or
  `beta.malleable`; off means no UI, `404`s and no bridge. Also: JSON Schemas for replays, comments, edits and plugins in
  `docs/formats/`, example plugins in `examples/malleable/`, and `ViewerRegistry.replacePlugin`. See
  [docs/malleability.md](docs/malleability.md).
- **Comments.** Comment on a whole replay or pin a comment to a moment: markers on the seek bar with a hover card, a
  Comments tab that follows the playhead, threads, resolve, author-only edit and delete, emoji reactions, comment
  permalinks (`#comment-<id>` with `?t=`) and the `M` shortcut. Times are stored on the source timeline and mapped
  through saved edits when the beta editor is on; comments in trimmed or cut stretches are listed as "In removed
  section". Authors come from the auth adapter (new optional `Identity.avatarUrl`; OIDC `picture`), anonymous with
  `AUTH_MODE=none`. Stored as `<id>/comments.json` on the filesystem or S3 driver (deleted with the replay), rate
  limited and length limited. On by default; `REPLAYS_COMMENTS=false` removes the UI and the API answers 404.
- **Replay editor (beta, off by default).** Non-destructive edit mode: trim, cuts, "Remove waits", speed-ups, zoom
  regions, blur boxes and captions, stored as an edit list next to the replay and honoured by playback and video exports.
  Enable with `REPLAYS_BETA_EDITOR=true` or `beta.editor` in the config file; with the flag off there is no editor UI,
  the edits API answers 404 and the editor code is not loaded.

- **Extension surface for custom distributions** ([docs/extension-api.md](docs/extension-api.md)):
  - `replays.config.ts|mjs|js|json` with a typed `defineConfig()`; `auth`, `storage` and `plugins` keys next to the existing ones.
  - `definePlugin()` and a plugin API with registration for auth adapters, test-context adapters (merged into the context
    schema), source-link providers, storage backends, branding, base path, request / response / upload-lifecycle hooks
    (`prepareUpload`, `beforeUpload`, `afterUpload`) and browser entries; ordering (`dependsOn`, `order`), validation and
    conflict errors (`PluginError` with stable codes).
  - Browser plugin API (`defineViewerPlugin`): inspector tabs, viewer actions and a side panel drawer, loaded from the server's
    plugin entries; failures are isolated.
  - `startServer()` (the server as a function; `replays serve` uses it), `SAMPLE_DIR`.
  - Subpath exports `@hazem3500/replays/{capture,server,viewer,plugin,config}` next to the root entry; the package now ships the
    built viewer, the samples and the extension docs. Policy in [docs/api-stability.md](docs/api-stability.md), decision in
    [docs/packaging.md](docs/packaging.md).
  - Comments are now a built-in plugin (`comments`, loaded first when enabled) instead of being wired into the server and the
    viewer: the API is a request hook, the tab, seek-bar markers and `M` key a built-in viewer feature. Behaviour is
    unchanged; plugin auth adapters' identities (with `avatarUrl`) become comment authors.
  - `examples/custom-distro` (workspace package) with an end-to-end smoke in CI, and `pnpm test:pack`.
  - [docs/downstream-migration.md](docs/downstream-migration.md).

### Removed

- The separate `/compare?before=&after=` page and its workspace, evidence panels and route.

### Changed

- The viewer's client router is TanStack Router: file routes in `src/client/routes/`, a router context of
  `{ queryClient, deployment }`, the base path as a runtime rewrite and plain-text search params, so every existing
  address (`/r/<id>?t=12.5`, `/?errors=1&sort=-duration`, `/r/<id>?suite=<suite>`, `/r/<id>/edit`) opens as before.
  Plugin pages (`api.registerPluginPage`) are routed at `/p/<plugin>/<path>`. An address that is no page now shows a
  not-found page instead of the index.

- The replay list's empty and error states name what happened and the way back: an unreachable server retries on a
  backoff (2 s, 5 s, 10 s, then every 30 s, at once when the browser comes back online) with a countdown; a failed
  refresh keeps the list on screen under an Offline banner; an empty purpose tab offers upload; a search or filters
  that leave nothing list the active filters with Clear search, Search all replays or Clear filters.

- Settings is a fixed-size dialog with a section sidebar (a full-screen section list with Back on phones): CLI & agents,
  Keyboard, Labs, Plugins (when a plugin registers a setting) and About. The colour theme lives only in the top bar.
- Beta flags have one model shared by the server and the page (`src/shared/beta-flags.ts`): the server allows a flag
  (`REPLAYS_BETA_*` or `beta.*`, parsed as before) and each person can opt out under Settings › Labs, saved in the browser.
- The built-in mark (timeline segments and a playhead) is the favicon too, with a home-screen icon and web manifest in
  `public/assets/brand` (`scripts/build-icons.mjs`). A deployment `logoUrl` replaces the tab icon and drops the built-in
  home-screen icon and manifest. Under reduced motion the header mark still fills on click, without movement.
- User plugins register in the viewer registry as `user:<id>` (keys `plugin:user:<id>:<contribution>`) instead of `user-<id>`, so a
  user plugin can no longer collide with, replace or remove the registrations of a host plugin named `user-<something>`.
- `GET /api/config` also lists the loaded `plugins`. `src/server/main.ts` is now a thin wrapper around `startServer()`.
- The library is built with shared chunks (`dist/lib/*.mjs`); the recorder script is shipped next to it.
- The repository is a pnpm workspace (`pnpm-workspace.yaml`); the Dockerfile installs only the main package.

### Security

- Relative `srcset` / `imagesrcset` candidates and CSS `url()` values (relative ones too) are redacted like other
  URLs, and suite and run registrations go through the same privacy pass as replay uploads.

- The suite index is built from the replay list instead of three lookups per run.

## [0.1.0] - Unreleased

First public-shaped version, extracted and generalised from an internal debugging tool.

### Added

- Capture CLI (`replays capture`): records a page with scripted steps into one `replay.json` (rrweb events,
  agent steps, console, sanitized HAR network track, performance) with an optional MP4; Playwright driver by default,
  `agent-browser` driver optional.
- Recorder as a library (`RecorderSession`) usable from any CDP connection, including a Playwright test.
- Self-hostable server: upload API, retention, "keep" pins, suites of runs, optional server-side video export and
  list posters, optional OpenTelemetry (OTLP) tracing.
- Viewer: one transport, error markers, synced Console / Network / Performance / Context tabs, permalinks,
  keyboard shortcuts, human rrweb import, review suites.
- Extension points: auth adapters (`none`, `header`, `oidc`, plugins), a user-supplied JSON Schema for context
  fields, source-link providers (GitHub, GitLab, URL, templates), storage drivers (filesystem, S3-compatible),
  runtime theming and branding, configurable base path and retention.
- Privacy defaults on: `maskAllInputs`, header / cookie / URL-credential / query redaction, no request or
  response bodies.
- Dockerfile and `docker-compose.yml` (built locally, nothing published), GitHub Actions CI, manual release and
  Pages workflows, static landing page in `site/`.

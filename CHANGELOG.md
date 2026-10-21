# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project aims to follow [Semantic Versioning](https://semver.org/) once it reaches 1.0.

## [Unreleased]

### Added

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

### Changed

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

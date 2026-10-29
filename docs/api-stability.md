# API stability and versioning

A custom distribution pins one version of `@hazem3500/replays` and builds on its extension surface
([extension-api.md](extension-api.md)). This page says what that pin protects.

## What is public API

Public means: documented here or in [extension-api.md](extension-api.md), exported from one of the subpath entries in
`package.json` `exports`, and listed in `test/public-api.test.ts` (which fails when an export is added, removed or renamed,
so every change to the surface shows up in a diff).

| Surface | Where | Status |
| --- | --- | --- |
| Config file keys and `defineConfig` | `@hazem3500/replays/config` | Public |
| Plugin API: `definePlugin`, `PluginApi` methods (including the web-standard `route` and `middleware`, with `PluginRoute`, `PluginMiddleware` and `StandardSchemaV1`) and their hook contexts, upload endpoint options, `PluginError` codes, `rejectUpload`, `HttpError`, `tooManyRequests`, `PLUGIN_API_VERSION` | `/plugin` | Public |
| Browser plugin API: `defineViewerPlugin`, `ViewerPluginApi`, `ViewerPluginContext`, the tab / action / panel definitions, editor tools, export formats and viewer shortcuts and typed activity subscriptions | `/viewer` | Public |
| Server entry: `startServer`, `createApp`, `ReplayStore`, auth and storage classes, `ObjectStorage` / `AuthAdapter` / `WebAuthAdapter` / `AnyAuthAdapter` types, `migrateStore` / `compareStores` and their report types | `/server` | Public |
| Contract suites: `describeObjectStorage`, `describeAuthAdapter`, `fakeRequest`. New checks may be added in a minor release when they pin documented behaviour | `/server/testing` | Public |
| Browser-safe in-page recorder, default UI, messages and formatting (`RecorderMessages`, `defaultRecorderMessages`, `RecorderFormat`; keys are added, not renamed), the `capture` option (`RecorderCapture`, `RecorderBodyLimits`; a profile's `capture` block is accepted as is, and keys only tighten), completion/theme contracts and upload helpers (`createTokenUpload`, `createHttpUpload`, `IssueUploadError`) | `/recorder` | Public |
| Capture and data model: recording, bundle building, sanitising, source providers, `ReplayBundle` and friends | `/capture`, `.` | Public |
| The replay format (`replay.json`, `meta.version`, the context block) | – | Public: changes are additive, or bump `version` and keep reading the old one |
| HTTP API (`/api/replays`, `/api/suites`, `/api/config`, `/api/me`, upload receipts) and environment variables | – | Public: changes are additive |
| `Identity` (`id`, `email`, `name`, `avatarUrl`, `capabilities`) as produced by auth adapters and seen by hooks | `/plugin`, `/server` | Public: fields are added, not removed |
| The `comments` plugin name and the comments HTTP API | – | Public: the name is reserved; the API changes additively |
| Theme tokens (`THEME_TOKENS`) | `/server` | Public: tokens are added, not renamed; [v2 catalogue](tokens.md) |
| Host edit write policy (`editing.enabled`, `EDITING_ENABLED`, `/api/config` effective capability) | – | Public: changes are additive; editor format remains beta |
| The editor (`beta.editor`) and its API | – | Beta: may change in any release |
| User plugins and the agent bridge (`beta.malleable`): the `.replays-plugin.json` format, `replays.*` sandbox API, `/api/malleable/*`, bridge tool names, `replays mcp` | – | Beta: may change in any release. The JSON Schemas in `docs/formats/` for replays, replay summaries, comments and edits follow the replay-format promise above |
| Everything else: files under `src/` (including the viewer's built-in feature registry, `src/client/plugins/features.tsx`), `dist/lib/chunks/`, any import path not in `exports`, CSS class names and DOM structure of the viewer, `data-testid` values other than those named in extension-api.md, log output, internal HTTP routes (`/internal/…`) | – | Not public |

Deep imports are blocked by `exports`; if you need something that is not exported, open an issue instead of copying the path:
it is a candidate for the surface.

The capture entry also exports `normalizeServerUrl`, `normalizeUploadUrl`, `resolveServerUrl`,
`resolveUploadEndpoint`, `saveServer`, and `uploadEndpoint` for CLI integrations. Server configuration stores
addresses, not authentication credentials. A wrapper that supplies credentials for a fixed destination must pass
that exact endpoint as `trustedUploadUrl` to `resolveUploadEndpoint`; saved targets and environment variables
cannot override it, and a conflicting explicit upload URL is rejected. Resolving an endpoint does not sign in
or attach credentials.

## Versions

The package follows [Semantic Versioning](https://semver.org/).

- **Patch** (`0.2.1`): fixes. No change to the public surface.
- **Minor** (`0.3.0`): additions: a new export, a new `PluginApi` method, a new optional field, a new hook context property, a new
  config key, a new `PluginErrorCode`. Existing plugins keep working unchanged. Contexts and options are objects so they can grow;
  **do not spread-and-forward them blindly** and do not rely on the exact set of keys.
- **Major** (`1.0.0`): removals and incompatible changes.

### Before 1.0

Until `1.0.0`, a **minor** release may contain breaking changes to the public surface. Every one is listed under *Changed* or
*Removed* in the [CHANGELOG](../CHANGELOG.md), and is announced one minor release earlier as a deprecation whenever it can be
(see below). Pin the version a distribution runs on to a minor (`~0.3.0`, or an exact version with a lockfile), read the
CHANGELOG when you move, and let `test/public-api.test.ts` plus your own plugin tests tell you what changed. The goal is that
reading the CHANGELOG is enough; the rules below are what we hold ourselves to from 1.0 on and already follow where possible.

## Plugin API generations

The browser plugin API has its own generation, `VIEWER_API_VERSION` (`@hazem3500/replays/viewer`, now `1`), stamped by `defineViewerPlugin`
and checked by the viewer in the same way; it moves on the same rule. Within a generation, a plugin that needs a newer minor declares
`requires` (a version range), and an older core refuses it at start instead of failing later.

`PLUGIN_API_VERSION` is the generation of the plugin API (now `1`). A plugin declares the generation it was written for (`definePlugin`
fills it in from the installed package). It increases only in a major release. A server refuses a plugin of an unsupported generation at
start, naming both numbers. A major release that raises it keeps loading the previous generation for at least one further major
release when that is feasible, and says so in the CHANGELOG; otherwise the CHANGELOG says what to change.

## Deprecation rules

1. A deprecation is announced in a minor release: the CHANGELOG entry (*Deprecated*), a `@deprecated` JSDoc tag naming the replacement,
   and, for something used at run time (a config key, an environment variable, a hook), a single `console.warn` at start.
2. The deprecated thing keeps working for **at least two minor releases and 90 days**, whichever is longer.
3. It is removed in the next **major** release (before 1.0: the next minor after that window, under the notes above).
4. Security fixes may shorten any window; the CHANGELOG says so.
5. Behaviour that was never documented can change in a patch or minor release.

### Deprecated purpose names

Purposes were renamed to profiles in the next release after 0.1.0 (CHANGELOG, *Deprecated*). The old
names keep working for the window above, each with a single start-up `console.warn` where it is used at run time:

| Deprecated | Use | Notes |
| --- | --- | --- |
| Config key `purposes` | `profiles` | Both at once stops the server |
| `api.purpose(definition)` | `api.profile(definition)` | Same definition; warns once per plugin |
| `PurposeConfig`, `PurposeInfo`, `PurposeOpenAt`, `PurposeViewerDefaults`, `PurposeDefinition`, `PurposeInferInput` | `Profile…` | Type aliases in `/plugin` and `/config` |
| `PurposeCatalog`, `createPurposeCatalog` | `ProfileCatalog`, `createProfileCatalog` | `/server`; also `AppSettings.purposes`, `ReplayStore.purposes`, `MigrateInfo.purposes` |
| `meta.purpose` in `replay.json` | `meta.profile` | Read on upload and stored as `meta.profile`; old stored bundles are read as they are. Different values in both is a `400` |
| `summary.purpose`, `summary.purposeInferred` | `profile`, `profileInferred` | Still in every API summary, always equal |
| `GET /api/replays?purpose=`, import `?purpose=`, index URL `?purpose=` | `?profile=` | |
| `PATCH /api/replays/<id>/meta` `{ purpose }` | `{ profile }` | Overrides saved before the rename are read as they are |
| `purposes` in `GET /api/config` | `profiles` | The same list |
| `x-replay-purpose` response header | `x-replay-profile` | Both are sent |
| `RETENTION_PURPOSE_<ID>_DAYS` | `RETENTION_PROFILE_<ID>_DAYS` | The new one wins when both are set |
| `--purpose <id>` (`capture`, `upload`, `import`) | `--profile <id>` | Warns on stderr |
| `posterAt(bundle, { purpose })` | `{ profile }` | Both are passed |

## What a distribution should do

- Depend on one version of `@hazem3500/replays`; do not mix versions of the subpath entries (they are one package, so this is natural).
- Import only from the subpaths in `exports`.
- Keep a test that starts the server with your config and plugins (see "Testing a plugin" in extension-api.md); it is the cheapest upgrade check.
- Run `pnpm up @hazem3500/replays` on a branch, read the CHANGELOG range, fix deprecation warnings, merge.

The additive slot API (`SlotRegistry`, `SLOT_NAMES`, `SlotDescriptor`, `SlotConfiguration`,
`SlotMountContext`, `ViewerPluginApi.configureSlot` and `registerSlotItem`) remains in viewer
API generation 1. `PLUGIN_API_VERSION` remains 1: generations increase for incompatible major
changes, not additions. Documented slot names, core item ids published by each view, and
`data-slot`/`data-slot-item` are public. A new slot or core id is additive; removing or renaming one
follows the deprecation rules above.

Sandboxed plugin settings (`manifest.settings`, asynchronous `ctx.settings.get/set`, and the
versioned per-person settings HTTP routes) are additive to the beta user-plugin format. The host
browser setting definitions and synchronous read/subscription contract are unchanged.

`replays plugin check` is an additive CLI command. `ViewerRegistry` is exported from `/viewer` for
isolated hosts and plugin harnesses; this is an additive browser API change in generation 1.


`ViewerPluginApi.registerPluginPage` and `PluginPageDefinition` / `PluginPageContext` /
`PluginPageLoadContext` are additive host-browser APIs. Plugin routes use `/p/<plugin>/…` and
scoped navigation. `Identity.roles`, host allow/deny selectors, workspace role policy and
watchdog configuration are additive. The beta malleable scope default changes to personal-only;
workspace publishing now requires an administrator role and per-person acceptance before code
runs. The malleable feature flag remains off by default. API generations remain 1; a future
flag-default change requires an announced minor release as described in malleability.md.

The additive sandbox viewer surface contract includes manifest `contextSections` and `tracks`, runtime `replays.section` and `replays.track`, and the host adapter's optional `TimelineTrackDefinition.onSelect`. The existing user-plugin format version remains 1; older hosts reject unknown contribution fields rather than running them with weaker permissions.

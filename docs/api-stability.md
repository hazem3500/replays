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
| Plugin API: `definePlugin`, `PluginApi` methods (including the web-standard `route` and `middleware`, with `PluginRoute`, `PluginMiddleware` and `StandardSchemaV1`) and their hook contexts, `PluginError` codes, `rejectUpload`, `PLUGIN_API_VERSION` | `/plugin` | Public |
| Browser plugin API: `defineViewerPlugin`, `ViewerPluginApi`, `ViewerPluginContext`, the tab / action / panel definitions | `/viewer` | Public |
| Server entry: `startServer`, `createApp`, `ReplayStore`, auth and storage classes, `ObjectStorage` / `AuthAdapter` types, `migrateStore` / `compareStores` and their report types | `/server` | Public |
| Contract suites: `describeObjectStorage`, `describeAuthAdapter`, `fakeRequest`. New checks may be added in a minor release when they pin documented behaviour | `/server/testing` | Public |
| Browser-safe in-page recorder, default UI, completion/theme contracts and upload helpers | `/recorder` | Public |
| Capture and data model: recording, bundle building, sanitising, source providers, `ReplayBundle` and friends | `/capture`, `.` | Public |
| The replay format (`replay.json`, `meta.version`, the context block) | – | Public: changes are additive, or bump `version` and keep reading the old one |
| HTTP API (`/api/replays`, `/api/suites`, `/api/config`, `/api/me`, upload receipts) and environment variables | – | Public: changes are additive |
| `Identity` (`id`, `email`, `name`, `avatarUrl`) as produced by auth adapters and seen by hooks | `/plugin`, `/server` | Public: fields are added, not removed |
| The `comments` plugin name and the comments HTTP API | – | Public: the name is reserved; the API changes additively |
| Theme tokens (`THEME_TOKENS`) | `/server` | Public: tokens are added, not renamed |
| Host edit write policy (`editing.enabled`, `EDITING_ENABLED`, `/api/config` effective capability) | – | Public: changes are additive; editor format remains beta |
| The editor (`beta.editor`) and its API | – | Beta: may change in any release |
| User plugins and the agent bridge (`beta.malleable`): the `.replays-plugin.json` format, `replays.*` sandbox API, `/api/malleable/*`, bridge tool names, `replays mcp` | – | Beta: may change in any release. The JSON Schemas in `docs/formats/` for replays, comments and edits follow the replay-format promise above |
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

## What a distribution should do

- Depend on one version of `@hazem3500/replays`; do not mix versions of the subpath entries (they are one package, so this is natural).
- Import only from the subpaths in `exports`.
- Keep a test that starts the server with your config and plugins (see "Testing a plugin" in extension-api.md); it is the cheapest upgrade check.
- Run `pnpm up @hazem3500/replays` on a branch, read the CHANGELOG range, fix deprecation warnings, merge.

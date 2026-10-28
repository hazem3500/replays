# Extensibility architecture: a core that host apps compose, and people reshape

Status: implementation and host migration guide; the [roadmap](#9-roadmap) links each concern. The selected package artifact must contain the referenced changes before a host migrates. Reference pages for what already
ships: [extension-api.md](../extension-api.md) (config, server plugins, browser entries), [extending.md](../extending.md) (the older
single-purpose points), [malleability.md](../malleability.md) (sandboxed user plugins and the agent bridge),
[api-stability.md](../api-stability.md) (what a version pin protects) and [packaging.md](../packaging.md) (one package, subpath exports).

## 1. Goal

A company should be able to run replays as **its own product** (its sign-in, its bucket, its vocabulary, its colours, its extra
panels) by writing a config file and a few plugins, and upgrade by bumping one version. No copied source, no fork to rebase.

The test case is a real one. An internal distribution (the "downstream") started as the tree this repository was generalised from,
and it still carries its own copy of the core. It runs behind Google's Identity-Aware Proxy, stores replays in Cloud Storage, sorts them
by *profile* (triage, design review, walkthrough) with a retention window per profile, links each replay to the people involved, and
receives uploads from an agent runner that authenticates with a service-account ID token. Section 8 maps each of those parts to an
extension point; when every row says "plugin" or "config", the downstream can delete its copy.

Non-goals: a marketplace, running untrusted server code, letting a host change the replay format.

## 2. Layers

Four layers, each owned by a different party, each able to extend the one below without editing it. The idea is Powermove's
(section 7): nothing above the core edits the core; it *contributes*, and every contribution can be taken away again.

| Layer | Who owns it | What it is | Trust | Changes when |
| --- | --- | --- | --- | --- |
| **Core** | this repository | data model, capture, server, viewer, built-in plugins (`comments`, `malleable`), first-party plugins (`iap`, `gcs`, …) | – | a release |
| **Host distribution** | the company that deploys | `replays.config.ts` + server plugins (`definePlugin`) + browser entries (`defineViewerPlugin`) + theme | trusted: runs in the server process and the viewer's page | a deploy |
| **Workspace** | a team inside the deployment | sandboxed user plugins shared with everyone (beta, `malleable`) | sandboxed, capability-brokered | someone keeps a version |
| **User** | one person | sandboxed user plugins, personal settings | sandboxed, capability-brokered | someone keeps a version |

Rules that hold across the layers:

1. **Contribute, don't patch.** Each extension point is a registry keyed by id. A layer adds entries; it never reaches into another
   layer's code. A host cannot import `src/`; `exports` blocks it ([api-stability.md](../api-stability.md)).
2. **Precedence is fixed and visible.** For settings: environment → config file → host plugins → core default. For surfaces (tabs,
   panels, actions, tracks, columns, sections, filters): core, then host, then workspace, then user, ordered by `order` inside a layer.
   `GET /api/config` exposes loaded plugin names and public configuration. Namespaced registrations retain their owner; the agent bridge lists the built-in and plugin inspector tabs, panels and actions with their ownership and lock policy.
3. **The host sets the policy for the layers above it.** It decides whether user plugins exist at all, which capabilities they may ask
   for, and which surfaces they may not cover (section 6).
4. **Data outlives code.** Contributions read and annotate replays; they never own the format. A replay recorded under one host's
   plugins opens in a plain core with those annotations shown as plain fields. A missing plugin degrades to "not shown", never to
   "cannot open".

## 3. Packages

**Decision kept: one package, `@hazem3500/replays`, with subpath exports** ([packaging.md](../packaging.md) gives the reasons: one
version means one compatibility story, `exports` already makes the boundaries real). The split the brief asks for is a split into
*modules with contracts*, and those are the subpaths:

| Subpath | Module | Contract | Runs in |
| --- | --- | --- | --- |
| `.` and `/capture` | **Core format and capture**: `ReplayBundle`, validation, the sanitiser and its rules, recorder drivers, bundle building, upload | the replay format (`docs/formats/*.schema.json`, `meta.version`), `RedactionRules` | Node, browser page |
| `/server` | **Server / gateway**: `startServer`, `createApp`, `ReplayStore`, storage and auth implementations, `verifyJwt` | HTTP API, `ObjectStorage`, `AuthAdapter`, `Identity` | Node |
| `/server/testing` | Contract suites for adapter authors (`describeObjectStorage`, `describeAuthAdapter`) | – | Node test runner |
| `/plugin` | **Plugin API**: `definePlugin`, `PluginApi`, hook contexts, `PluginError`, `PLUGIN_API_VERSION` | the server plugin API generation | Node |
| `/viewer` | **Viewer plugin API**: `defineViewerPlugin`, slots | the browser plugin API generation | browser, no Node, no React |
| `/config` | `defineConfig`, `loadConfig` | config keys | Node |
| `/plugins/<name>` | **First-party plugins**, opt-in: `iap` (Identity-Aware Proxy), `gcs` (Cloud Storage over its JSON API, no SDK) | same as any plugin | Node |

First-party plugins are plugins in the ordinary sense: they use only `/plugin` and `/server`, they are listed in a config like a
third-party one, and a host that wants something different writes its own. They live here because they are generic (any Google Cloud
deployment wants them) and because shipping them makes the adapter APIs carry their own weight.

When to split into separate npm packages is unchanged ([packaging.md](../packaging.md#what-it-costs-and-when-to-split)); if it
happens, the subpath names become package names and the umbrella re-exports them.

## 4. The plugin API: typed, versioned, stable

- **Two APIs, one generation number each.** `PLUGIN_API_VERSION` (server, `/plugin`) and `VIEWER_API_VERSION` (browser, `/viewer`), both
  `1`. A plugin is stamped with the generation it was built for (`definePlugin` / `defineViewerPlugin` fill it in) and refused, with both
  numbers named, by a core of another generation. Generations move only in a major release.
- **Additive inside a generation.** New registration methods, new optional fields, new context properties: a minor release. Contexts
  and options are objects so they grow; plugins must not depend on their exact key set.
- **A plugin can say which core it needs.** `requires: '>=0.4 <0.6'` (a semver range over the package version, optional). A core
  outside the supported range refuses the plugin at start (`PluginError` `version-range`). The accepted range subset is documented in `extension-api.md`; it is not a complete npm range parser. This is the guard for features added within a
  generation: a host plugin that uses `api.purpose` declares `>=0.4`.
- **Everything is checked at start.** Ids (`[a-z][a-z0-9-]{0,39}`), duplicates, conflicts between plugins, schemas: a bad plugin stops
  the server with a stable `PluginError` code and the plugin's name, before anything listens. Run time errors in hooks are logged and
  isolated (a failing tab shows an error box; a failing `afterUpload` never fails the upload).
- **Contracts are tested.** `test/public-api.test.ts` pins the export list; `/server/testing` lets an adapter author run the same suites
  the built-in adapters pass; `docs/formats/` pins the data.
- **Deprecation** follows [api-stability.md](../api-stability.md): announced in a minor, warned once at start, kept two minors and 90 days.

## 5. Extension points

"Today" means shipped before this design; the rest are added by the PRs in the [roadmap](#9-roadmap). Every server registration is a
method on `PluginApi`; every browser one on `ViewerPluginApi`; most have a config-file equivalent for the no-code case.

| Point | Server (`api.*`) | Browser (`api.register*`) | Config key | Status |
| --- | --- | --- | --- | --- |
| Storage backend | `storage({ id, create })` | – | `storage` | today; `/plugins/gcs`, exported errors and contract suite new |
| Auth adapter | `auth({ name, create })` | – | `auth` | today; `verifyJwt` and `/plugins/iap` new |
| Identity resolver | `identity({ resolve(identity, request) })` | – | – | new |
| Profiles and taxonomies | `profile({ id, label, retentionDays, infer, viewer, poster })` | – | `profiles` | new |
| Retention | `retention({ days(summary) })` | – | `retentionDays`, per profile | new |
| People | `people({ roles, validate, handles, avatarUrl, profileUrl })` | – | `people` | new |
| Context metadata | `contextAdapter({ name, schema, normalize })` | `registerContextSection` | `contextSchemaFile` | today; widgets and sections new |
| Source links | `sourceProvider({ id, label, resolve, icon, noun })` | – | `sourceProviders` | today; icon, noun, attrs new |
| Redaction rules | `redaction(rules)` | – | `redaction` | new |
| Summary fields (indexable) | `summaryFields({ name, fields(bundle) })` | – | – | new |
| Index columns, filters, sections | `indexFilter({ id, param, match })` | `registerIndexColumn`, `registerIndexFilter`, `registerIndexSection` | – | new |
| Viewer panels, tabs, actions | – | `registerViewerPanel`, `registerInspectorTab`, `registerViewerAction` (+ `placement: 'bar'`) | – | today; bar placement new |
| Timeline tracks | – | `registerTimelineTrack({ id, label, markers(ctx) })` | – | new |
| Settings | – | `registerSetting({ id, label, type, default })` | – | new |
| Theme and brand tokens | `branding({ name, logoUrl, theme })` | CSS variables, `ctx.theme` | `name`, `logoUrl`, `theme` | today; `theme-color` meta and static build new |
| Upload hooks | `prepareUpload`, `beforeUpload`, `afterUpload` | – | – | today |
| Additional upload endpoints | `uploadEndpoint({ path, prepare })` | – | – | scoped intake extension |
| Exact-origin request policy | `requestPolicy({ path, methods, origins, headers, credentials })` | – | – | scoped intake extension |
| Sign-in recovery | auth adapter `signIn` metadata | generic failed-fetch recovery | `signIn` | CDN/IAP extension |
| Edit write policy | enforced on edit PUT | controls and route policy | `editing.enabled` | independent of beta playback gate |
| Capture pacing | public capture options | shared caption/idle/speed behavior | `capture.stepPauseMs` | defaults preserve existing capture pause |
| Request hooks | `onRequest` (pre/post auth), `onResponse` | – | – | today |
| Render pipeline | `render({ posterAt(bundle), beforeRender(job), afterRender(job, file) })` | – | – | new |
| Base path and hosts | `basePath` | – | `basePath`, `hosts`, `trustForwardedHost` | today for one path; per-host new |
| User-plugin policy | – | – | `malleable.policy` | new |

### 5.1 Storage

`ObjectStorage` (`read`, `write` with `createOnly`/`ifVersion`, `list`, `delete`, …) is the whole contract. New: `kind` becomes an open
string, and a backend sets `listCacheMs` to get the store's listing cache that `s3` gets today. `ObjectExistsError`,
`PreconditionFailedError`, `assertKey` and `globToRegExp` are exported, because the comments and malleable stores rely on `instanceof`.
`/server/testing` exports `describeObjectStorage(name, factory)`, the suite every built-in backend passes.

`/plugins/gcs`: `ifGenerationMatch=0` for create-only writes, the generation as ETag, resumable uploads above 8 MB, `matchGlob` listing,
credentials from the metadata server (Workload Identity) or `GOOGLE_OAUTH_ACCESS_TOKEN`, emulator via `STORAGE_EMULATOR_HOST`.
Configured by `GCS_BUCKET`, `GCS_PREFIX`.

### 5.2 Auth and identity

An `AuthAdapter` turns a request into an `Identity` (`id`, `email`, `name`, `avatarUrl`) or refuses it. `verifyJwt({ token, jwksUrl,
issuer, audience, algorithms, leewaySec, requireIat })` is exported so a proxy adapter is a few lines.

`/plugins/iap({ audience, domains, serviceAccounts })`: verifies `x-goog-iap-jwt-assertion` (ES256, Google's JWKS, issuer
`https://cloud.google.com/iap`, exact audience, `iat` required), accepts emails in the listed domains and the exact service accounts (an
entry that is not a `*.gserviceaccount.com` address stops the server). The agent runner that uploads with an ID token is one of those
service accounts; nothing else is needed for it.

`api.identity({ resolve(identity, { request }) })` runs after authentication and may enrich the identity (a display name and avatar from a directory). It may
not change `id`.

### 5.3 Profiles and taxonomies

A profile answers "why was this recorded?", and it changes how a replay is kept, opened and listed. Tags cannot carry that.

```ts
api.profile({
  id: 'triage', label: 'Triage', order: 0,
  retentionDays: 90,                                   // 0 = keep forever; RETENTION_PROFILE_TRIAGE_DAYS overrides
  infer: ({ errors, sources, suiteRun }) => errors > 0, // optional; first match in order wins
  viewer: { openAt: 'first-error', leadMs: 1000, inspector: 'open' },
  poster: 'first-error',                               // or 'middle-step' (default), 'last-step'
});
```

Core: optional `meta.profile` (checked against the registered ids on upload), `summary.profile` and `summary.profileInferred`,
`?profile=` on `GET /api/replays`, segment tabs with counts on the index (only when profiles exist), a picker in the upload dialog, and
`profiles` in `/api/config`. An inferred profile never makes a replay permanent: only an explicit one can. The config file can declare
profiles without code (`profiles: [{ id, label, retentionDays, viewer, poster }]`); `infer` needs a plugin.

`api.retention({ days(summary) })` is the general form, for policies that are not about profile. The shortest window any rule returns
wins, `0` means keep, and *Keep* still overrides.

### 5.4 People

```ts
api.people({
  roles: ['pr-author', 'reviewer', 'requester', 'assignee', 'uploader', 'mentioned'],  // priority order for "for me"
  validate: (person) => person.email?.endsWith('@example.com') ? undefined : 'staff only',
  handles: [{ id: 'github', label: 'GitHub username', pattern: '^[a-z0-9-]{1,39}$' }],
  avatarUrl: (person) => person.handles?.github && `https://github.com/${person.handles.github}.png`,
});
```

Core: `meta.people` (at most 10 `{ role, email?, name?, handles? }`), `people` on suites, `--person role:email[:handle]` on the CLI,
`?for=me` on replays and suites (matched against the signed-in identity and the handles the person linked, with the matching `reason`),
and an avatar stack on index rows when people are present. Without `api.people` the roles are free text and nothing is validated
beyond shape and size.

### 5.5 Redaction rules

The sanitiser's defaults stay on and cannot be weakened. A host adds rules; they apply in the capture CLI (which reads the same config
file) and again in the server's privacy pass, so an upload from an old producer is cleaned too.

```ts
api.redaction({
  headers: [/^x-acme-session$/i],        // added to the secret-header list
  queryParams: ['invite_token'],
  jsonKeys: ['ssn', /card_?number/i],    // request/response bodies and console arguments
  text: [{ pattern: /\bACME-\d{6}\b/g, replace: '[ticket]' }],
  maskSelectors: ['[data-private]'],     // masked in the DOM snapshot at capture
});
```

### 5.6 Index: summary fields, columns, filters, sections

The index lists summaries, not bundles, so anything a column or filter shows must be in the summary. `api.summaryFields({ name,
fields(bundle) })` derives small values at upload (strings, numbers, booleans, capped) into `summary.ext[plugin]`. `api.indexFilter({
id, param, match(summary, value) })` filters on the server. In the browser, `registerIndexColumn({ id, label, render(el, summary) })`
adds a field to each row, `registerIndexFilter({ id, label, type: 'switch' | 'choice' | 'text', param })` adds a control to the filter
menu, and `registerIndexSection({ id, title, render(el, { summaries, me, apiUrl }) })` adds a block above the list (a "For you" strip).

### 5.7 Viewer: panels, tabs, actions, timeline tracks, context sections, settings

Already: inspector tabs, side panels and More-menu actions drawing into a DOM node. New: `placement: 'bar'` for actions; timeline tracks
(`markers(ctx)` returns `{ atMs, durationMs?, label, tone }[]`, drawn as a row on the seek bar, click seeks); context sections (a block
inside the built-in Context tab, and schema hints `x-replays-widget: 'signals'` for tri-state flag lists, `x-replays-group` and
`x-replays-order`); settings (a typed toggle or choice in the More menu, stored per person, readable as `ctx.settings`).

### 5.8 Theme and brand

Tokens (`page`, `surface`, `text`, `accent`, `ring`, …) for dark and light, the name and the logo, from config or `api.branding`. New:
`<meta name="theme-color">` follows the `page` token; `replays build-static --out dir` produces a viewer that can be served from a CDN
with the base path, name and tokens stamped in (the server-side injection does not run there).

### 5.9 Render pipeline

Posters and video exports are produced by the render queue. `api.render({ posterAt(bundle) })` picks the poster moment (the profile's
`poster` setting is sugar for it); `beforeRender(job)` may veto or change options; `afterRender(job, file)` sees the result (copy to a
CDN, notify).

### 5.10 Base path and hosts

One base path today. New: `hosts: { 'replays.example.com': { basePath: '' } }` serves the same process at a different base per
`Host`, with `Vary: Host` on responses that depend on it, and `trustForwardedHost` for a gateway that rewrites `Host`.

### 5.11 Intake routes and request policy

A host can register an additional upload path with `api.uploadEndpoint({ path, prepare })`. Its optional translation runs before the global upload preparation hooks; the result goes through the same validation, sanitizer, upload hooks, store and media scheduling as ordinary uploads. The alias has normal authentication and same-origin enforcement. No customer-specific route is built into core.

Staff browser recording intake can opt into `api.requestPolicy({ path: '/api/replays', methods: ['POST'], origins: ['https://app.example.com'], headers: ['content-type', 'content-encoding'], credentials: true })`. Paths are canonical and exclude the deployment base. Only the configured path/method/exact origin gets CORS and the narrow CSRF exception; actual data requests still authenticate. Preflight validates its method and headers before auth. Refusals retain the applicable CORS headers, and unrelated read/write routes retain their normal policy. Wildcard origins and a global CSRF-disable switch are outside the contract.

Backend forwarder authorization belongs in the host's auth adapter. Restrict such an identity to its exact upload path and method before any built-in plugin can answer a request; a later host request hook alone is insufficient. Host normalization owns fresh ids, source/profile and bounded product metadata, then hands the result to the core pipeline.

### 5.12 Sign-in recovery across a CDN

A public CDN page can load even while IAP refuses its API requests. Auth adapters provide sign-in metadata; static hosts explicitly set `signIn: { path: '/api/sign-in' }` so the viewer receives the canonical endpoint before its first API fetch. The core distinguishes signed-out responses from network failures, normalizes same-origin return paths, preserves query/hash/base and bounds automatic retries. A manual sign-in link remains available when automatic recovery or browser storage is unavailable. Uploads and internal render calls do not navigate to sign-in pages.

### 5.13 Edit writes and saved playback

`beta.editor` remains the outer feature gate. With it enabled, `editing: { enabled: false }` hides editor entry points and rejects edit writes while retaining saved edit reads, playback and MP4 exports. The environment override is `EDITING_ENABLED`. This is independent of user-plugin capabilities. Posters, opening stills and hover previews remain as recorded.

### 5.14 Capture and playback pacing

`capture: { stepPauseMs: 1200 }` configures a host's capture pause; `--step-pause` overrides it. Values are bounded to 0–10000ms and the existing zero-pause core default is retained. Labels derived from selectors must not include typed secrets. Idle skipping, held-caption selection/rail numbering and the speed list (including 0.25×) are shared between viewer and export paths so a host need not patch either implementation.

## 6. Trusted host plugins and sandboxed user plugins

|  | Host plugin | User / workspace plugin |
| --- | --- | --- |
| Written by | the deploying company | anyone with access, or an agent |
| Installed by | a deploy (config file) | *Keep* in the workshop, with an approval token |
| Runs | in the server process (`definePlugin`) and the viewer's page (`api.client`) | in a sandboxed frame: opaque origin, no network, capability broker |
| Can | everything in section 5 | the `replays.*` sandbox API: read the open replay, draw a tab/panel/action, ask for `comments:write`, `export:download` |
| Versions | git and the image tag | a full in-app history: diff, revert, export |
| Undo | redeploy the previous image | revert to any version, instantly |

They meet in the viewer's registry: both register tabs, panels and actions there, under their own names (a user plugin id is shown
`user:<id>`, so it cannot collide with a host one). New, the host's **policy for the upper layers**, in the config:

```ts
malleable: {
  enabled: true,
  scopes: ['user', 'workspace'],
  capabilities: { 'comments:write': 'ask', 'export:download': 'deny' },  // the host can narrow, never widen
  lockedSurfaces: ['inspector:context'],                                // user plugins cannot replace or hide these
},
```

and the **upgrade contract** for user plugins (Powermove's, adapted): a manifest records `targets: { core, distribution }` (the versions
it was kept under); after a host upgrade, plugins whose sandbox API generation still matches keep running, and any that fail to load
get a quiet "review plugins" notice. Nothing is disabled, deleted or rewritten automatically.

## 7. What we take from Powermove

[Powermove](https://github.com/iterative-computer/powermove) is a video editor whose UI is extensions on a tiny kernel, which an agent
extends in place, undoably. Read against its README, `docs/design.md` and `apps/desktop/docs/EXTENSIONS.md`:

| Powermove principle | Here |
| --- | --- |
| Tiny kernel; built-ins use the same API as mods | `comments` and `malleable` are server plugins on the same `definePlugin` API as a host's; first-party `iap`/`gcs` are ordinary plugins. (The viewer half of the built-ins still uses an internal React registry; moving them onto the public browser API is a later step) |
| Extend in place, never edit the bundle | Layers contribute to registries (section 2); `exports` makes editing the core impossible from a host |
| Every change is undoable; prior versions are kept | User plugins: full history (shipped). Host layer: the deploy is the version; the config is in git; rollback is a redeploy. In-app versioning of host config is not a goal for now |
| Layered scopes (built-in → user → project), id-keyed overrides, `dependsOn`, `replaces` | core → host → workspace → user; `dependsOn` and `order` (shipped); `lockedSurfaces` is the host's veto. We do not add `replaces` for host plugins: a host that wants a different built-in turns it off in config |
| Overrides are owned and reversible | Every registration belongs to a plugin and goes away with it; a user plugin's settings are its own |
| Upgrade safety: health per app version, review notices, never auto-disable | `targets` in user-plugin manifests and the review notice (section 6); `requires` ranges for host plugins |
| The agent as a first-class editor, through typed tools, staged drafts, verification | The agent bridge (shipped): typed tools on live state, drafts, diagnostics, a person keeps. Extended: `get_plugin_api` includes the host's tokens and registered surfaces, so agent-written plugins fit the distribution |
| Data is the stable core; a missing extension leaves a placeholder | Rule 4 of section 2; `summary.ext` and `context.fields` are plain data |
| Trust follows provenance; capabilities per mod | Host = trusted, user = sandboxed (shipped); the host narrows user capabilities (section 6) |

Not taken: running untrusted code unsandboxed because it was "made locally" (a viewer page holds a signed-in session; every user
plugin is sandboxed), and a 3-way rebase of forked built-ins (host plugins are not sandbox-compatible source, so there is nothing to fork).

## 8. The first consumer: the downstream

How each downstream-only part maps (the full table, with file paths, is in
[downstream-migration.md](../downstream-migration.md)):

| Downstream part | Becomes |
| --- | --- |
| Identity-Aware Proxy auth, service-account allow-list, dev mode | `iap()` from `/plugins/iap`; `auth: 'none'` locally |
| Cloud Storage | `gcs()` from `/plugins/gcs` |
| Profiles, retention per profile, profile viewer defaults and posters | `profiles` in the config (or `api.profile` with `infer`) |
| People on replays and suites, "for me", person card, "For you" | `api.people` + the core people support; "For you" as an index section |
| Typed product test context, admin links, flag lists | a context adapter with a schema using `x-replays-widget: 'signals'` |
| Chat, support and VCS provenance links with brand marks | source providers with `icon` and `noun` |
| Palette, name, logo | `name`, `logoUrl`, `theme`, plus a client `style` file for extra primitives |
| Old paths, the own-domain root host, CDN-served frontend | a `pre-auth` redirect hook, `hosts`, `replays build-static` |
| Old upload shapes (`meta.source: 'toki'`, typed context, source `kind`) | `prepareUpload` + a context adapter; `replays migrate` for stored data |
| Staff app intake, browser sign-in recovery and disabled edit writes | scoped request policy, adapter/config sign-in metadata and independent edit-write config |
| Backend customer forwarding (pending downstream work) | optional upload endpoint alias and host auth/normalization plugin |
| Deployment runtime and pending workspace restructuring | stay in the downstream; both web and gateway consume the same pinned artifact |
| Deploy workflows, gateway, secrets, samples | stay in the downstream |

`examples/host-app` is this mapping as a runnable distribution with neutral names: IAP auth, Cloud Storage, three profiles, people
rules, a theme, a "For you" section and a provenance provider, built only from config and plugins, with an end-to-end smoke test.

The mapping is refreshed against downstream `4390e7a5` (2026-10-24), including the real gateway/renderer, sign-in recovery, staff browser intake and disabled editing. Pending customer-forwarding and workspace-restructuring branches remain separate migration inputs. The initial migration retains upstream's stricter input/URL sanitization, so staging readability differs; the migration guide records that deliberate boundary.

Migration order: pin a tested immutable artifact; compose config/plugins/theme beside the old app; validate producers, IAP, CDN/gateway paths, scoped intake and saved-edit playback; rehearse conversion into a separate store while preserving trusted retention age and nonmedia sidecars; compare summaries and representative content; stage and cut over with a write/rollback plan; delete copied core source last. Follow the concrete [step list](../downstream-migration.md#migration-steps-for-the-later-downstream-pr). Converting stored data after deleting the old app is not the first migration rehearsal.

## 9. Roadmap

Small pull requests, each with its own tests and docs, merged in about this order.

| # | Change | Extension points |
| --- | --- | --- |
| [#5](https://github.com/hazem3500/replays/pull/5) | Architecture document | – |
| [#8](https://github.com/hazem3500/replays/pull/8) | Adapter kit: exported storage errors and helpers, open `kind` + `listCacheMs`, `verifyJwt`, `/server/testing` contract suites, `requires` ranges, `VIEWER_API_VERSION` | 5.1, 5.2, 4 |
| [#9](https://github.com/hazem3500/replays/pull/9) | First-party `iap` and `gcs` plugins (`/plugins/*`) | 5.1, 5.2 |
| [#13](https://github.com/hazem3500/replays/pull/13) | Purposes and retention rules | 5.3 |
| [#10](https://github.com/hazem3500/replays/pull/10) | Redaction rules | 5.5 |
| [#16](https://github.com/hazem3500/replays/pull/16) | People and identity resolvers | 5.2, 5.4 |
| [#15](https://github.com/hazem3500/replays/pull/15), [#17](https://github.com/hazem3500/replays/pull/17) | Index and viewer slots: summary fields, index columns/filters/sections, bar actions, timeline tracks, context sections and widgets, settings, source-provider icons | 5.6, 5.7 |
| [#7](https://github.com/hazem3500/replays/pull/7) | Hosts, `theme-color`, static build | 5.8, 5.10 |
| [#14](https://github.com/hazem3500/replays/pull/14) | Render hooks | 5.9 |
| [#12](https://github.com/hazem3500/replays/pull/12) | User-plugin policy and upgrade contract | 6 |
| [#11](https://github.com/hazem3500/replays/pull/11) | `replays migrate` | 8 |
| [#18](https://github.com/hazem3500/replays/pull/18) | Pin the matching Node runtime | packaging/runtime |
| [#20](https://github.com/hazem3500/replays/pull/20) | Composed privacy, migration, retention-age and cache integrity fixes | 5.1, 5.5, 5.9, 8 |
| [#21](https://github.com/hazem3500/replays/pull/21) | Host editing write policy with saved-edit playback | 5.13 |
| [#22](https://github.com/hazem3500/replays/pull/22) | Scoped browser intake policy and upload aliases | 5.11 |
| [#23](https://github.com/hazem3500/replays/pull/23) | Browser sign-in recovery | 5.12 |
| [#24](https://github.com/hazem3500/replays/pull/24) | Capture pacing, shared captions and playback/export speeds | 5.14 |
| [#25](https://github.com/hazem3500/replays/pull/25) | `examples/host-app` | all |
| [#26](https://github.com/hazem3500/replays/pull/26) | Refresh the architecture and downstream migration guide | documentation |

A reviewed source mapping does not replace the real IAP/CDN/GCS staging checks in the migration guide.

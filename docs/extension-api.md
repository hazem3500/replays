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
  src/client.ts           defineViewerPlugin(...): inspector tabs, actions, panels → bundled to one .js
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
  purposes: [{ id: 'triage', label: 'Triage', retentionDays: 90 }],   // see "Purposes and retention" below
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
| `api.sourceProvider(provider)` | A `{ id, label, resolve(ref) }` link provider (chat, support, VCS style), usable as `--source id:ref` and in `context.sources` | id taken, built in (`github`, `gitlab`, `url`) or defined in the config's `sourceProviders` |
| `api.storage({ id, create({ env, dataDir }) })` | An [`ObjectStorage`](extending.md#storage) selected by `STORAGE=<id>` or the config's `storage`. Its `kind` is any string (usually the id); set `listCacheMs` when listing is remote and slow | id taken or built in (`fs`, `s3`, `memory`) |
| `api.branding({ name?, logoUrl?, theme? })` | Name, logo (https URL or base64 data image) and [theme tokens](extending.md#theming-and-branding) | the same field set to different values by two plugins; the config file and environment override plugins without error |
| `api.basePath('/replays')` | The default base path | two plugins disagree; config and `BASE_PATH` override |
| `api.onRequest(hook, { phase? })` | `hook({ request, response, path, identity? })`, return `true` after answering. `post-auth` (default): only authenticated requests, with `identity`, after the same-origin check. `pre-auth`: every request except the health checks. `path` has the base path removed | – |
| `api.onResponse(hook)` | `hook({ method, path, status, durationMs, identity? })` after each response; errors are logged | – |
| `api.prepareUpload(hook)` | `hook({ body, identity, request })` on the raw `POST /api/replays` body before any validation; return the body to use (translate a producer's older shape) | – |
| `api.beforeUpload(hook)` | `hook({ bundle, identity, request })` on the validated, sanitised bundle before it is stored. Throw `rejectUpload(status, message)` to refuse; return a bundle to replace it (it is validated again). Also runs for `POST /api/replays/import` | – |
| `api.afterUpload(hook)` | `hook({ bundle, identity, request, url })` after the bundle is stored; errors are logged and never fail the upload | – |
| `api.redaction({ headers?, queryParams?, jsonKeys?, text?, maskSelectors? })` | [Redaction rules](extending.md#redaction-rules) added to the sanitiser's defaults, in the capture CLI (which reads the same config) and the server's privacy pass. Rules from several plugins and the config's `redaction` add up; they cannot turn a default off. Validate your own with `assertRedactionRules` (`/plugin`, `/capture`) | – (invalid rules are an `invalid-registration`) |
| `api.client({ id, script, style? })` | A browser entry, served by the app behind the same auth (an absolute file path) or loaded from an `https:` URL | the same `id` twice in one plugin |
| `api.purpose({ id, label, order?, retentionDays?, viewer?, poster?, infer? })` | A [purpose](#purposes-and-retention): why a replay was recorded. `infer(input)` recognises one uploaded without `meta.purpose` | id taken by another plugin (a config entry with the same id overrides its fields instead) |
| `api.retention({ days(summary) })` | A [retention rule](#purposes-and-retention) that is not about purpose: whole days, or `0` / `undefined` for no limit | – |
| `api.render({ posterAt?, beforeRender?, afterRender? })` | [Render pipeline hooks](#render-pipeline-hooks): the poster's moment, a veto or option change before each render, a call after each stored file | – (hooks run in plugin order) |

Upload order: `prepareUpload` → context adapters → source links resolved → validation and context schema → privacy pass →
`beforeUpload` → store → `afterUpload`. The core checks cannot be skipped by a hook: an adapter or hook that produces an
invalid bundle gets a `400`.

`GET /api/config` lists the plugins that are loaded (`plugins: ["acme-distro"]`), and the auth adapter in use.

### Choosing an auth adapter

```
AUTH_MODE (env)  →  config.auth  →  the only plugin adapter  →  built-in default (none)
```

A name is looked up among plugin adapters first, then the built-ins. `AUTH_MODE=plugin AUTH_PLUGIN=./x.mjs` (the older
mechanism) still works.

## Purposes and retention

A purpose answers "why was this recorded?" (a bug triage, a design review, a walkthrough) and changes how a replay is kept,
opened, listed and drawn. **The core defines none.** A deployment declares them in the config file, or a plugin registers
them (and only a plugin can *infer* one):

```ts
// replays.config.ts (or the same list in replays.config.json)
purposes: [
  { id: 'triage', label: 'Triage', retentionDays: 90, viewer: { openAt: 'first-error', leadMs: 1000, inspector: 'open' }, poster: 'first-error' },
  { id: 'walkthrough', label: 'Walkthroughs', order: 2, retentionDays: 0, viewer: { inspector: 'collapsed', captions: true }, poster: 'last-step' },
],

// a plugin
api.purpose({ id: 'triage', label: 'Triage', infer: ({ errors, sources }) => errors > 0 && sources?.some((s) => s.provider === 'jira') === true });
api.retention({ days: (summary) => (summary.tags?.includes('scratch') ? 3 : undefined) });
```

| Field | Meaning |
| --- | --- |
| `id` | `[a-z][a-z0-9-]{0,39}`; unique |
| `label` | Shown on the index tab, the upload picker and in `/api/config` (at most 40 characters) |
| `order` | Lower first (tabs, and the order `infer` is tried in). Default 0; ties keep declaration order: config entries first, then plugins in plugin order |
| `retentionDays` | Whole days to keep a replay of this purpose; `0` keeps it forever. `RETENTION_PURPOSE_<ID>_DAYS` overrides it (the id upper-cased, `-` as `_`: `RETENTION_PURPOSE_DESIGN_REVIEW_DAYS`). Absent: `retentionDays` / `RETENTION_DAYS` |
| `viewer.openAt` | `'start'` (default) or `'first-error'`: open `viewer.leadMs` (default 1000) before the first console error or failed request, on the tab that holds it. A permalink (`?t=`, `#step-…`) wins |
| `viewer.inspector` | `'open'` or `'collapsed'`: the bottom panel when the person has no stored choice |
| `viewer.captions` | Step captions on the player when the person has no stored choice |
| `poster` | The list thumbnail's moment: `'middle-step'` (the default), `'first-error'` or `'last-step'`. A plugin's [`posterAt`](#render-pipeline-hooks) wins over it |
| `infer(input)` | Plugins only. `input` is the replay's summary (counts, `sources`, `tags`, `suiteRun`, `title`, `url`, …) plus `errors`; return `true` to claim the replay. The first purpose (in `order`) that says yes wins; a throwing `infer` counts as no and is logged once |

- **Config and plugins.** Two plugins registering the same id is a `conflict` error. A config entry with a plugin purpose's id
  overrides that purpose's fields (`viewer` key by key) and keeps its `infer`, so a host can retune a plugin's purpose without code.
  A malformed entry stops the server with the field named.
- **Uploads** may carry `meta.purpose` (`POST /api/replays`), or `?purpose=` on `POST /api/replays/import`. It must be one of the
  registered ids; anything else is a `400` naming the allowed ids. With no purposes registered, an upload that carries one is
  refused (`400`, "this server defines no purposes") rather than stored with a purpose nothing knows: a producer finds out at once,
  and a `prepareUpload` hook can drop or translate the field. The CLI takes `--purpose <id>` on `capture`, `upload` and `import`;
  the upload dialog offers a picker (bundles and rrweb imports) when purposes exist.
- **Summaries** gain `purpose` and `purposeInferred` (`SUMMARY_VERSION` 7). Only the explicit purpose is stored in the sidecar;
  inference runs when the server lists, so a changed rule applies to stored replays at once. Removing a purpose from the
  config leaves `meta.purpose` in the stored bundles; it is shown as a plain field and no longer affects anything.
- **Listing.** `GET /api/replays?purpose=<id>` filters; `GET /api/config` lists `purposes` (`[]` in a plain core); the index shows
  "All · <purpose> …" tabs with counts (only when purposes exist), kept in the URL as `purpose=`. A suite counts under the purposes
  of its runs' replays.
- **Viewer.** A replay's purpose is its `meta.purpose`, else the inferred one, which the server sends as
  `x-replay-purpose: <id>; inferred` with the bundle (cached with it for up to a day). The viewer marks it as `data-purpose` on
  `main.app-shell`.
- **Retention.** The purpose's window replaces the default one. **An inferred purpose never makes a replay permanent**: if its
  window is `0`, the default window applies; only an explicit purpose (or Keep) keeps a replay forever. `api.retention` rules can
  only shorten: the shortest positive window among the default/purpose window and every rule wins, `0` or `undefined` means no
  limit from that rule, and **Keep** (or a kept suite) still overrides everything. A rule that throws or returns something other
  than a whole number of days is logged once and ignored. Rules see the summary, so they apply to replays, not to suites (suites
  use the default window).

## Render pipeline hooks

Posters (the index thumbnails), opening stills, hover previews and video exports are made by headless Chromium on the server.
`api.render` hooks into all of them:

```ts
api.render({
  // The poster's moment in ms on the replay's timeline; undefined passes to the next hook.
  posterAt: (bundle, { purpose }) => (purpose === 'checkout' ? bundle.steps.find((step) => step.kind === 'submit')?.at : undefined),
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

- **`posterAt(bundle, { purpose })`** picks where the poster is taken. Hooks run in plugin order and the first one that returns a
  finite number (≥ 0) wins; `undefined` passes on. After the hooks comes the purpose's `poster` setting
  ([purposes](#purposes-and-retention)), which is the same mechanism's built-in last step, then the default (`middle-step`). The time
  is clamped to the replay and never lands before its first document. A hook that throws or returns something else is skipped and
  logged. The answer is remembered per replay for the life of the process (a bundle never changes), so keep it a pure function of the
  bundle and the purpose; the bundle is only read when a `posterAt` hook exists.
- **Poster caching.** A poster's file name says which moment it shows: `poster.v2.jpg` for the default, `poster.v2-first-error.jpg`
  for a purpose setting, `poster.v2-t<ms>.jpg` for a hook's time. When a deploy changes the choice for a replay, its next poster
  request looks for a new name, so the old file is never served again and a new one is made (the old one is pruned with the
  replay). Posters stored where nothing chooses keep their name, so adding hooks never invalidates the default ones. Browsers
  that cached a poster (a week) keep showing it until that expires.
- **`beforeRender(job)`** runs before each render. Return `false` to refuse it; return some of `{ speed, captions, skipInactive }` to
  change a video export (`speed` one of 0.5, 1, 1.5, 2, 4, 8; the others booleans). Other keys, invalid values and option changes
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
  narrow. `scopes` (`'user'`, `'workspace'`; default both) says where a plugin may be kept; `capabilities` maps each capability to
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

## Browser entries: inspector tabs, viewer actions, panels

A server plugin points at one ES module with `api.client({ id: 'main', script: '/abs/path/client.js' })`. (Deployment code uses this DOM-based API; the built-in comments use the React feature registry described above.) The viewer imports it
after the first paint and calls its default export. A failing entry is logged to the console and skipped; it never breaks the viewer
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
  api.registerViewerPanel({ id: 'notes', title: 'Notes', slot: 'side', render(container, ctx) { return ctx.onTime((ms) => { … }); } });
});
```

- **Inspector tabs** join Console / Network / Performance / Context in the bottom panel (`data-testid="plugin:<plugin>:<id>-tab"`,
  content `…-panel`).
- **Viewer actions** are items in the header's **More** menu (`data-testid="plugin-action:<plugin>:<id>"`); `when` can hide one per replay.
- **Viewer panels** open from the **More** menu into a drawer on the right (`slot: 'side'`, `data-testid="plugin-panel:<plugin>:<id>"`).
  This is the extension point for features that need room and live state, such as a comments thread.
- `render(container, context)` draws into the DOM node it is given; return a function to be called on unmount.
- The **context** is `{ replay, theme, basePath, apiUrl(path), getTime(), onTime(listener), seek(ms), notify(message) }`. `replay` is the open
  bundle (metadata, steps, console, network, `context`); treat it as read-only. Use `apiUrl('…')` and `fetch` (same origin, the user's
  session) to talk to your own endpoints, which a server plugin adds with `api.onRequest`.
- Theme: read `theme` and the CSS custom properties (`var(--text)`, `var(--surface)`, `var(--accent)` …, the same tokens as
  [branding](extending.md#theming-and-branding)) so a tab follows light/dark and the distribution's colours. A `style` file on the
  client entry is loaded as a stylesheet.
- Registration errors (a bad id, a duplicate, a missing function) throw to the entry and are logged with the plugin's name.
- **Generations.** `defineViewerPlugin` stamps the plugin with `VIEWER_API_VERSION` (now `1`, exported from `/viewer`). A viewer of
  another generation does not call it and logs `plugin <name> (<id>) refused: built for viewer API <n>, this viewer provides <m>`.
  A bare function default export (no `defineViewerPlugin`) carries no stamp and is loaded as before.

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
- Test behaviour with `startServer({ port: 0, config: { dir, file: {}, plugins: [plugin] } , env: { DATA_DIR, POSTERS_DISABLED: '1', RENDER_DISABLED: '1' } })`.
- `examples/custom-distro/e2e/smoke.spec.ts` shows a browser-level check of each extension point.

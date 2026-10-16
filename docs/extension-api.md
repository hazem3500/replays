# Extension API

This is the reference for building a **custom distribution** on top of replays without forking it: a config file, plugins
for the server, and a browser entry for the viewer. A runnable example is [`examples/custom-distro`](../examples/custom-distro);
the stability promise is in [api-stability.md](api-stability.md), the packaging decision in [packaging.md](packaging.md).
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
| `@hazem3500/replays/server` | `startServer`, `createApp`, storage, auth, store | Node |
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
  retentionDays: 30,             // RETENTION_DAYS
  contextSchemaFile: './context.schema.json',
  githubHost: 'github.example.com', gitlabHost: 'gitlab.example.com',
  sourceProviders: [{ id: 'jira', template: 'https://jira.example.com/browse/{ref}' }],
  beta: { editor: false },
  auth: 'acme-iap',              // AUTH_MODE: a built-in mode or an adapter a plugin registered
  storage: 'gcs',                // STORAGE: fs, s3 or a backend a plugin registered
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
  order: 0,                      // optional: lower first among independent plugins
  setup(api) {
    api.auth({ name: 'acme-iap', create: (env) => ({ name: 'acme-iap', authenticate: (request) => … }) });
    api.branding({ name: 'Acme Replays' });
  },
}));
```

`definePlugin(plugin)` returns the plugin; `definePlugin((options) => plugin)` returns a factory you call in the config. `apiVersion`
is filled in (`PLUGIN_API_VERSION`, currently `1`); a plugin written for another version is refused at start with both numbers named.

**Ordering.** Plugins are set up dependencies first, then by `order` (default 0, ascending), then by position in the config.
Hooks and context adapters run in that same order. A missing dependency, a duplicate name or a cycle is a start-up error.

**Errors.** Everything found at start throws a `PluginError` with a stable `code` (`invalid-plugin`, `duplicate-plugin`,
`api-version`, `missing-dependency`, `dependency-cycle`, `invalid-registration`, `conflict`, `setup-failed`, `load-failed`) and a
message that starts with the plugin's name. The server prints it and exits; nothing listens.

### What `setup(api)` can register

| Call | Registers | Conflicts |
| --- | --- | --- |
| `api.auth(adapter \| { name, create(env) })` | An [`AuthAdapter`](extending.md#auth-adapters) selected by `AUTH_MODE=<name>` or the config's `auth`. With exactly one registered and nothing chosen it is used; with several and nothing chosen the server refuses to start | name taken by another plugin or built in (`none`, `header`, `oidc`, `plugin`) |
| `api.contextAdapter({ name, schema?, normalize? })` | Runs on every upload and suite registration, **before** validation: `normalize(context, { kind, identity, request })` returns the context to use. `schema` (an object schema) is merged into the deployment's context schema, which validates the result and titles the Context tab | name taken; a field defined differently by two adapters or by the schema file |
| `api.sourceProvider(provider)` | A `{ id, label, resolve(ref) }` link provider (chat, support, VCS style), usable as `--source id:ref` and in `context.sources` | id taken, built in (`github`, `gitlab`, `url`) or defined in the config's `sourceProviders` |
| `api.storage({ id, create({ env, dataDir }) })` | An `ObjectStorage` selected by `STORAGE=<id>` or the config's `storage` | id taken or built in (`fs`, `s3`, `memory`) |
| `api.branding({ name?, logoUrl?, theme? })` | Name, logo (https URL or base64 data image) and [theme tokens](extending.md#theming-and-branding) | the same field set to different values by two plugins; the config file and environment override plugins without error |
| `api.basePath('/replays')` | The default base path | two plugins disagree; config and `BASE_PATH` override |
| `api.onRequest(hook, { phase? })` | `hook({ request, response, path, identity? })`, return `true` after answering. `post-auth` (default): only authenticated requests, with `identity`, after the same-origin check. `pre-auth`: every request except the health checks. `path` has the base path removed | – |
| `api.onResponse(hook)` | `hook({ method, path, status, durationMs, identity? })` after each response; errors are logged | – |
| `api.prepareUpload(hook)` | `hook({ body, identity, request })` on the raw `POST /api/replays` body before any validation; return the body to use (translate a producer's older shape) | – |
| `api.beforeUpload(hook)` | `hook({ bundle, identity, request })` on the validated, sanitised bundle before it is stored. Throw `rejectUpload(status, message)` to refuse; return a bundle to replace it (it is validated again). Also runs for `POST /api/replays/import` | – |
| `api.afterUpload(hook)` | `hook({ bundle, identity, request, url })` after the bundle is stored; errors are logged and never fail the upload | – |
| `api.client({ id, script, style? })` | A browser entry, served by the app behind the same auth (an absolute file path) or loaded from an `https:` URL | the same `id` twice in one plugin |

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

Another built-in feature would follow the same two steps: a server plugin (if it needs routes) and a registered viewer feature.

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

## Starting the server

`replays serve` reads `replays.config.*` and the environment. To own the entry point:

```ts
import { startServer } from '@hazem3500/replays/server';
const server = await startServer({ handleSignals: true });   // { origin, port, close(), runtime }
```

`startServer` options: `env`, `cwd`, `config` (skip discovery), `plugins` (in addition to the config's), `port` (`0` = free port),
`host`, `sampleDir`, `dev`, `handleSignals`, `log`. `SAMPLE_DIR` (or `sampleDir`) replaces the bundled demo replays, for
example with an empty directory. Docker: the image reads the config from its working directory (`/app`), so a distribution
adds its files with `COPY` and sets nothing else.

## Testing a plugin

- Unit-test registration with `resolvePlugins([plugin])` from `@hazem3500/replays/plugin`; it returns what was registered, or throws the `PluginError`.
- Test behaviour with `startServer({ port: 0, config: { dir, file: {}, plugins: [plugin] } , env: { DATA_DIR, POSTERS_DISABLED: '1', RENDER_DISABLED: '1' } })`.
- `examples/custom-distro/e2e/smoke.spec.ts` shows a browser-level check of each extension point.

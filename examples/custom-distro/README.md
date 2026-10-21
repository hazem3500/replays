# custom-distro

A complete custom distribution built on the extension surface, as a downstream would build it: **no fork**, just a dependency on
`@hazem3500/replays` (here a workspace link), a config file, one plugin and one browser entry.
Reference: [docs/extension-api.md](../../docs/extension-api.md).

| File | What it shows |
| --- | --- |
| `replays.config.ts` | `defineConfig({ plugins: [acme(...)] })` |
| `src/plugin.ts` | `definePlugin`: signed-header ("IAP-style") auth, a context adapter with a schema, a chat source-link provider (with its own icon, noun and an attribute), branding (name, logo, theme tokens), a base path, request / response / upload hooks, summary fields and a server-side index filter (`?x-env=`), and the registration of the browser entry |
| `src/iap.ts` | The fake identity header: `{ email, aud, exp }` signed with HMAC-SHA256 (a real proxy would sign a JWT; see `examples/auth-signed-header`) |
| `src/client.ts` | `defineViewerPlugin`: an inspector tab, a More-menu action and a header-bar action, a side panel, a timeline track of console problems, a Context-tab section and two settings, and in the index a column, a filter and a section ("Uploaded by you"), drawn into DOM nodes |
| `src/server.ts` | `await startServer()`, the whole entry point |
| `scripts/build.mjs` | esbuild: `src/client.ts` → `dist/client.js` |
| `e2e/smoke.spec.ts` | Starts the server and checks that each extension is active |

## Run it

From the repository root (the example uses the built library and viewer):

```bash
pnpm install
pnpm build && pnpm build:cli
pnpm --filter @hazem3500/replays-example-custom-distro build
DISTRO_SIGNING_SECRET=dev-secret pnpm --filter @hazem3500/replays-example-custom-distro start   # http://127.0.0.1:8080/acme/replays/
```

Every request needs `x-acme-identity: <body>.<signature>` (see `src/iap.ts`); without it the app answers `403`. Only `/healthz` is public.
Try it with a browser extension that adds the header, or `curl`:

```bash
TOKEN=$(cd examples/custom-distro && node --experimental-strip-types --no-warnings -e \
  "import('./src/iap.ts').then((m) => console.log(m.signIdentity({ email: 'ada@acme.test', aud: 'acme-replays', exp: Date.now() / 1000 + 600 }, 'dev-secret')))")
curl -H "x-acme-identity: $TOKEN" http://127.0.0.1:8080/acme/replays/api/config
```

## Test it

```bash
pnpm test:distro      # build everything, typecheck the example, run the end-to-end smoke
```

The smoke test proves, with a real browser: auth is enforced (missing, forged, expired, wrong-audience and wrong-domain identities are
refused; `/healthz` is public), the context adapter stamps uploads and the Context tab renders its fields with the schema's titles, the
chat link resolves with its icon and attribute, the name, logo and theme tokens are applied under the base path, the custom tab is visible and drawn by the browser
entry, the actions and the panel work from the More menu and the header bar, the console-problems track seeks, the Context section and
the settings follow each other, the upload hooks refuse and count, and plugin files are only served behind auth.
The index shows the plugin's column, section and filter, with summary fields derived at upload and filters matched by the server.
CI runs it in the `Custom distribution example` job.

# Packaging: one package with subpath exports

**Recommendation (implemented): a single package, `@hazem3500/replays`, with subpath exports.** No split into `-capture`,
`-server`, `-viewer`, `-plugin` packages.

| Subpath | Contents | Needs |
| --- | --- | --- |
| `@hazem3500/replays/capture` | Recorder, drivers, bundle building, sanitiser, source providers, data model | Node, `playwright-core` / `rrweb` for recording |
| `@hazem3500/replays/server` | `startServer`, `createApp`, store, storage and auth implementations | Node |
| `@hazem3500/replays/viewer` | Browser plugin API (`defineViewerPlugin` and types) | nothing (no Node, no React); safe in a browser bundle |
| `@hazem3500/replays/plugin` | `definePlugin`, errors, plugin types | Node |
| `@hazem3500/replays/config` | `defineConfig`, `loadConfig` | Node |
| `@hazem3500/replays` | The original umbrella entry, kept for compatibility | Node |

The built viewer (`dist/client`) and the sample replays ship in the package, so `replays serve` and `startServer` work from an
installed copy with no repository checkout.

## Why one package

1. **One version means one compatibility story.** The plugin API, the server that calls it, the browser API that the viewer
   implements and the replay format change together. With split packages a distribution would have to keep four versions in
   step, and a mismatch (a new server with an old `-plugin` types package) fails at run time, in someone's deployment. With one
   package the lockfile cannot express a mismatch.
2. **The boundaries are real without separate packages.** `exports` makes the subpaths the only way in, and the library is built
   with shared chunks, so `PluginError` is one class whichever entry you import it from (`instanceof` works across `/plugin`,
   `/config` and `/server`). `/viewer` is verified free of Node and React imports (`test/public-api.test.ts`), which is the property
   a separate browser package would have been for.
3. **Releases stay cheap.** One changelog, one tag, one publish. A split would need a release tool (changesets or similar), dependency
   ranges between our own packages and a policy for lockstep versions; none of that buys the user anything today.
4. **The consumer set is one kind of consumer.** Everyone who writes a plugin also runs the server; the people who only record
   (`/capture`) are served by the same install and the CLI.

## What it costs, and when to split

The cost was install weight for the narrow consumer, so the heavy dependencies are optional peers: `dependencies` is only
`playwright-core`, and `dist/cli` is a self-contained bundle (`scripts/build-cli.test.mjs` fails if it imports a server or
viewer module). The server and viewer dependencies (OpenTelemetry, the UI libraries and the rest) are `peerDependencies` marked
optional, pinned in `devDependencies` for this repository. Code that imports the library entries installs the peers it uses.

`replays serve`, `migrate`, `mcp`, `build-static` and `plugin check` need them. `bin/replays.mjs` checks whether they resolve beside
the package and, if not, installs them with `npm install` into `<cache>/viewer-<version>-<key>` (`~/.cache/replays`, or
`$XDG_CACHE_HOME/replays`, `%LOCALAPPDATA%\replays`, or `REPLAYS_VIEWER_CACHE`), shows a spinner, copies the package's `dist` and
`sample` next to the install and runs from that copy (`src/viewer-runtime.ts`). Later runs reuse it. A failed install leaves no cache
behind. Delete old `viewer-*` folders to reclaim space. Split into separate packages only if one of these becomes true:

- consumers who only record complain about install size or supply-chain surface, and optional peer dependencies are not enough;
- the capture side needs a different release cadence from the server (for example it is embedded in test runners that cannot
  tolerate server releases);
- a part needs a different licence or a different owner.

If it happens, the subpath names become the package names (`@hazem3500/replays-capture`, …) and the umbrella package re-exports them,
so imports written against the subpaths keep working.

## Capture-only staging boundary

`pnpm build:capture` independently builds `dist/capture-package`, a private CLI-only staging artifact. It does not replace or publish the full package. It supports `capture`, `import`, `upload`, `connect`, `login`, `status`, `logout`, `config` and `doctor`. The upload helpers retain the existing credential, device approval and server-selection behavior. `serve`, `migrate`, `build-static`, `plugin` and `mcp` fail with exit status 2 and a full-distribution requirement. The full launcher and all existing exports remain unchanged.

The staging manifest exposes no library exports or declarations. It includes the CLI, prebuilt rrweb recorder, capability manifest and license, not the viewer, Start server or samples. Config, plugin validation and context-schema helpers remain bundled where capture requires them; this is not a promise of zero server-named source inputs. Custom config and plugin modules, their dependencies, a browser and any selected external driver executable remain consumer-provided. No capture, privacy, redaction or authentication contract changes.

Runtime dependencies are derived from the emitted external import graph and must already exist in the root runtime dependency manifest. The build fails on undeclared externals or viewer, MCP and server entry points. `build-evidence.json` records actual source inputs, external imports and dependency versions. rrweb is bundled in the recorder; current Node imports include Playwright, WebSocket, esbuild and schema validation. CI records the actual closure rather than relying on this illustrative list.

The artifact retains the upstream package identity and version because plugin compatibility discovers that identity at runtime. It is deliberately private. Consumers must not rename it or replace an existing full wrapper that advertises server commands without their own explicit compatibility and command-surface migration. This boundary adds no publish target or new package release cadence.

The CI **Capture-only artifact** job builds, packs and installs it in isolation, checks command help and omitted-command failures, resolves declared dependencies and uploads the staging tree with exact-head build and smoke evidence. Installed import/upload validation and capture help exercise runtime module loading without launching a browser. Real authenticated upload and capture still require their normal integration tests; artifact presence alone is not proof of those flows.

## Build

`pnpm build` builds the viewer (`dist/client`); `pnpm build:cli` builds `dist/cli` (the command), `dist/lib` (the six entries with shared
chunks, plus the page-side recorder) and `dist/types` (declarations). The package is still `"private": true`: nothing here publishes.

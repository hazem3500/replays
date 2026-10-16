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

The cost is install weight for the narrow consumer: someone who only wants `/capture` also installs everything in `dependencies`,
including the OpenTelemetry packages and the viewer's UI libraries. Split, or move heavy dependencies to optional peers,
only if one of these becomes true:

- consumers who only record complain about install size or supply-chain surface, and optional peer dependencies are not enough;
- the capture side needs a different release cadence from the server (for example it is embedded in test runners that cannot
  tolerate server releases);
- a part needs a different licence or a different owner.

If it happens, the subpath names become the package names (`@hazem3500/replays-capture`, …) and the umbrella package re-exports them,
so imports written against the subpaths keep working.

## Build

`pnpm build` builds the viewer (`dist/client`); `pnpm build:cli` builds `dist/cli` (the command), `dist/lib` (the six entries with shared
chunks, plus the page-side recorder) and `dist/types` (declarations). The package is still `"private": true`: nothing here publishes.

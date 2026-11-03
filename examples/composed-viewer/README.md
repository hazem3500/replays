# Compose a player in your own application

This host imports only published package entries. The React page loads two independent recordings with host-built
controls, steps and diagnostics. `headless.html` uses the framework independent playback service and pure diagnostics
with native DOM controls. Both accept local replay JSON; neither calls the Replays API or uses its router/auth/cache.

Build the package first, then from the repository root on Boat:

```sh
pnpm --dir examples/composed-viewer check
pnpm --dir examples/composed-viewer start
```

Open the example's server on port 8082. The browser consumer suite uses its configured server:

```sh
pnpm exec playwright test -c examples/composed-viewer/playwright.config.ts
```

React composition needs React 19 or newer. The headless page has no React dependency in its runtime graph. Browser
builds need a bundler that resolves package exports and CSS imports; the example uses esbuild. Import the chosen
player's explicit `/style.css` entry once; the example supplies all other layout and visual styles itself. The Node
build scripts use the repository's declared Node engine range. Playwright browser prerequisites follow the root setup.

See [lifecycle, diagnostics and integration boundaries](../../docs/playback-and-model.md). Recordings are treated as
immutable while loaded, replacement validates before changing the current player, and page teardown releases mounts,
subscriptions and the engine. Local file validation is not a privacy sanitizer.

# Agent-Native browser integration spike

This local-only host is the first migration slice toward **Agent-Native as Replays' default application runtime**. It uses the **actual** `@agent-native/core@0.220.0` browser client to consume Replays' existing WebMCP tools. Open a replay and select the **Agent-Native** inspector tab. The framework retains native descriptors and bounds results; a small context facade converts its serialized arguments to native WebMCP's object inputs. This tests framework interoperability without an LLM, database or cloud account.

It does **not** run Agent-Native's embedded agent, action dispatcher, auth, PostgreSQL migrations, SQL tools or live-sync server. See [the evaluated adoption design](../../docs/agent-native-adoption.md) before adopting those. The sample is deliberately `auth: 'none'` with filesystem storage; use it on loopback only.

From the repository root, in the session's Boat box:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm build:cli
pnpm --filter @hazem3500/replays-example-agent-native check
HOST=127.0.0.1 pnpm --filter @hazem3500/replays-example-agent-native start
```

The Node requirement is 22.22+ for this example (the framework's requirement). The rest of Replays keeps its existing Node requirement. The client plugin is bundled from public package exports; it neither imports private Replays source nor registers duplicate tools/polyfills. Supplying a document facade explicitly prevents the framework client from initializing its own polyfill over the existing context. The facade preserves descriptor identity, native receiver binding and abort signals, leaving the real page context untouched. Discovery retries during delayed initialization, has an explicit Retry discovery control, and stops when the tab unmounts.

The tab can inspect the replay, seek, install a sandboxed draft and **request** Keep. There is no save/approve tool. Keep opens the existing human dialog; only its explicit approval persists a plugin. Running the client in a trusted host plugin grants no extra capability to sandboxed user plugins. Cancellation stops observation and signals the consumer; it cannot undo a completed seek or prompt.

To exercise the actual client against native WebMCP and the local stand-in, and check the built Storybook fixtures in one browser worker:

```sh
pnpm build:storybook
pnpm exec playwright install chromium
env -u CHROME_PATH -u PLAYWRIGHT_CHROMIUM_EXECUTABLE CHROMIUM_NO_SANDBOX=1 \
  pnpm --filter @hazem3500/replays-example-agent-native test
```

The test enables `--enable-features=WebMCP` and **fails** if the native API is missing; it never relabels the stand-in as native support. Use the browser pinned by the committed Playwright version, as CI does; an older system Chrome can hide native API incompatibilities. The stand-in case shadows the browser API in a separate page context. Both cases check draft installation and that requesting Keep leaves the saved plugin list empty. Additional cases delay configuration until the tab opens and switch permission stories within one preview document. All servers started by this spec are closed on teardown. Storybook must already be built.

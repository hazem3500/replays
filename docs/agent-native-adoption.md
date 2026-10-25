# Agent-Native, WebMCP, Effect, XState and Storybook

Evaluated 25 October 2026 against Replays main `0198c19` (the merged modular host/plugin architecture). Recommendation: keep the portable replay engine and public contracts, adopt Agent-Native first as an **optional host integration**, and add Storybook now. Evaluate an isolated Effect server job and an XState approval machine only when their additional guarantees pay for the migration. This change implements the browser integration and Storybook; it does not convert the application to any new server framework.

## The specific framework

This means [BuilderIO/agent-native](https://github.com/BuilderIO/agent-native), linked from [agent-native.com](https://www.agent-native.com/), not the broader idea that agents and people should share application tools. Replays already shares its bridge tool catalog and handlers between browser tools and external MCP.

The [published core package](https://www.npmjs.com/package/@agent-native/core/v/0.220.0) evaluated here is **0.220.0**, MIT, with Node **>=22.22.0** and an `agent-native` CLI. Its unpacked registry size was 36,064,726 bytes. [Source package metadata](https://github.com/BuilderIO/agent-native/blob/1368ef45977eda3fbb6b933518ddf33c244071b2/packages/core/package.json) and [license](https://github.com/BuilderIO/agent-native/blob/1368ef45977eda3fbb6b933518ddf33c244071b2/LICENSE) were checked at source main `1368ef45977eda3fbb6b933518ddf33c244071b2`. Package and source are distinct snapshots; the integration pins the published package and validates its actual exports. The package brings a broad runtime dependency graph even when importing one browser subpath; its presence in an optional example is intentional.

### Fit against Replays

| Area | Framework behavior | Replays fit and adoption consequence |
| --- | --- | --- |
| Data | PostgreSQL with Drizzle; optional local PGlite | Replays' `ObjectStorage` backs portable JSON bundles, sidecars, suites, edits, comments and plugins through filesystem/S3/GCS. It is not a Drizzle database adapter. Use SQL for host-owned conversations/jobs, keep replay blobs under the existing store. A unified SQL replay index would need a new consistency/rebuild design. |
| Auth | Better Auth by default; custom `getSession` supported | Keep the selected Replays auth adapter as authority. A host must map verified identity to stable framework user/org identity and define workspace isolation; forwarding arbitrary headers is insufficient. Do not auto-mount a second independent login or enable a shared-user bypass. |
| Actions | Validated typed actions shared by UI, agent, HTTP, MCP and other surfaces | A good host seam for selected operations. Reuse public APIs and existing authorization; do not expose every storage primitive as an action. Calling `.run()` directly does not reproduce dispatcher access/approval enforcement. |
| Sync | Action hooks wrap TanStack Query; SSE with polling fallback | Replays already uses TanStack Query and a separate browser bridge/SSE path. A host may sync its own SQL data. Object-store writes do not automatically produce framework database invalidations. Avoid two caches claiming authority over replay metadata. |
| Embedded agent | React sidebar/chat with server conversation/runtime infrastructure | A browser component is only the presentation layer. Server routes, provider credentials, identity, persistence, tool selection and execution limits still need a real host deployment. The spike does not pretend to supply them. |
| Plugins | Trusted app/runtime extensions, plus sandbox/CLI adapter seams | Replays deploy-time plugins execute trusted host code. User plugins remain opaque-origin frames with CSP and a capability broker. A framework Node child process or remote sandbox adapter is a different execution boundary and cannot replace that browser sandbox. |

Primary evidence: [database/PGlite constraints](https://www.agent-native.com/docs/server-database/), [authentication and custom sessions](https://www.agent-native.com/docs/authentication/), [action validation and dispatch boundaries](https://www.agent-native.com/docs/actions-defining/), [action hooks and sync](https://www.agent-native.com/docs/client-data/), [embedded UI](https://www.agent-native.com/docs/drop-in-agent/), and [runtime adapter responsibilities](https://www.agent-native.com/docs/sandbox-adapters/). PGlite is documented for local development, not shared production. The framework's [durable runs](https://www.agent-native.com/docs/durable-background-runs/) use SQL run records, heartbeats and event logs; those semantics do not exist merely because Replays uses an object store.

### First working integration

[examples/agent-native](../examples/agent-native/README.md) is a local optional host, composed through public Replays config/server/plugin/viewer exports. Its trusted inspector tab uses the real `createAgentNativeWebMcpClient({ document })` from `@agent-native/core/client/webmcp` to list and execute Replays tools. This is an actual consumer of the framework's descriptor binding, input serialization, bounded output handling and cancellation API, rather than a renamed Replays adapter or unused dependency. The minified browser module is approximately 32 kB before compression.

No Agent-Native dependency enters the core runtime or default viewer bundle. Workspace development installs do resolve the optional example's dependency graph. The core Docker install remains filtered to the root package. Removing the example leaves the public contracts and portable recording format intact.

For a full framework host, the next slice should own a separate SQL database for conversations/run receipts and expose **read-only replay metadata** through authenticated actions backed by public Replays APIs. Only after identity/isolation and lifecycle tests pass should chat be added. Keep browser-local seek/draft tools in the existing page bridge. Host SQL actions must never invoke `saveApproved`, mint a consent token, save a plugin, or present a framework chat approval as Replays Keep approval. Explicitly filter automatic framework tool exposure so privileged host capabilities do not leak into browser tools.

## WebMCP already exists

`src/client/malleable/webmcp.ts` registers `BRIDGE_TOOLS` from `src/shared/malleable-tools.ts` using the handlers in `src/client/malleable/tools.ts`. `src/mcp` exposes the corresponding out-of-page MCP door. These predate this change. Both allow inspection, seek, sandboxed plugin drafts and `request_keep`; neither offers a save/approve tool. The malleability flag remains the outer gate.

The [current Community Group draft](https://webmachinelearning.github.io/webmcp/) places `modelContext` on `document`, with asynchronous registration and abort-driven removal. It remains experimental, not a W3C Recommendation. Replays keeps a compatibility path for early `navigator.modelContext` producers. [Chrome's imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api) documents browser-mediated registration; API availability and availability of an agent consumer are separate questions.

The [primary implementation-status page](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md) lists Chrome's trial from 149 and Edge's from 150, Brave's experimental integration, and Firefox/Safari position/tracking links. These are not evidence of universal stable-browser support. Local testing requires the browser feature flag or a suitable origin trial; production needs HTTPS and the deployment's trial setup where applicable. The integration test explicitly asserts that native support is present before calling its case native.

Concrete gaps fixed here:

- The stand-in now accepts both object inputs and JSON-string inputs. The latter is what [the actual Agent-Native client](https://github.com/BuilderIO/agent-native/blob/1368ef45977eda3fbb6b933518ddf33c244071b2/packages/core/src/client/webmcp.ts) sends to ordinary browser contexts. Previously the string reached handlers as if it were an object.
- A reused stand-in keeps `native: false`, including after uninstall/reinstall. Previously its mere presence was misreported as native.
- Already-aborted lifecycle signals cannot register tools. Execution rejects non-object JSON and respects an already-aborted execution signal.
- Concurrent installs await one registration result. Synchronous registration from older implementations works; a failed installation aborts its partial registrations and permits retry.
- Handler failures return structured errors so native consumers can read actionable error messages rather than losing thrown messages in browser mediation.

The stand-in is intentionally page-local. It does not implement browser permissions, cross-frame discovery, native descriptor identity, complete JSON Schema enforcement, external-agent discovery, or cancellation of every underlying handler. Those are not conformance claims. User plugin frame boundaries and human Keep remain enforced by the existing sandbox/broker/server paths, not by WebMCP annotations.

## Effect: evaluate at a server job boundary

Current [Effect 4 documentation](https://effect.website/docs/v4/onboarding) describes typed success/failure/dependency channels, structured concurrency, resource safety and services. The registry version checked was **4.0.6**. Old unversioned error/resource links redirect to **v3** docs, so a v4 adoption should pin v4 and verify APIs rather than copy those older examples. [Effect's resource model](https://effect.website/docs/v3/resource-management/introduction) explains the acquisition/release motivation, but is not the v4 API contract.

The best candidate is `src/server/render-queue.ts` plus `renderer.ts`: temporary directories, browser/process ownership, timeout, cancellation, upload and post-render hooks. Typed `RenderFailed`, `StoreUnavailable` and `Cancelled` failures, scoped cleanup and explicit `ReplayStorage`/`RenderRunner` services could make this lifecycle easier to compose and verify. Keep a Promise-returning `RenderRunner` and existing public storage/plugin contracts at the boundary; map failures to existing status/error responses there.

The queue already bounds concurrency, deduplicates variants, passes `AbortSignal`, cleans up resources, persists status, and marks interrupted jobs failed after restart. Introducing Effect is therefore a migration with parity tests, not a missing-feature fix. It does not make jobs durable across crashes, make an external Promise cancellable unless the signal reaches it, or make retried writes safe without idempotency/preconditions. Agent-Native already has its own durable agent-run lifecycle; avoid nesting a second orchestrator around it.

Incremental cost: one service boundary, a scoped runner, typed error mapping, cancellation wiring into Chromium/ffmpeg/storage, and tests for timeout/upload failure/shutdown/cleanup. Budget a small dedicated PR and benchmark before wider use. A global conversion would change error conventions and dependencies across every adapter and plugin consumer with little evidence of benefit. **Recommendation: defer installation; prototype one runner when server job complexity next grows.**

## XState: approval transitions before playback clocks

The registry version checked was **5.33.3**; the live Stately site also advertises a **v6 alpha**, so use a deliberate stable-major choice. [Invoked actors](https://stately.ai/docs/invoke) have state-bound start/stop lifetimes; [Promise actors](https://stately.ai/docs/promise-actors) can carry async work. Aborting an actor still needs the underlying operation to observe its signal.

Current Replays uses a player controller/external store, React state for editor/workshop UI, a manager with revision/source tracking, a permission request queue, and a plain render status union. The highest-value machine would model **one draft approval**: `draft → requestingKeep → reviewing → saving → saved`, with `cancel`, `sourceChanged`, `saveFailed` and `discard` events. A source change must invalidate the pending review and its consent binding; a save failure should return to review with retry information. The machine orchestrates the existing manager/broker; it cannot confer server authorization.

Do not migrate the high-frequency rrweb playhead to an actor per tick; keep time subscriptions. A small coarse `loading/ready/playing/paused/failed` machine might help future playback races, but current controller ownership should remain intact. Likewise, `LoadingSwap` already expresses its few phases clearly and auth is mostly server/proxy policy; neither justifies XState on its own. Agent-Native chat approvals and durable run states overlap with host workflows, so choose one owner for each lifecycle rather than mirroring them in a second machine.

Incremental cost: define a typed event/context model, adapt one manager subscription, connect actor disposal and late-result rejection, and test source-change-during-review, cancel-during-save, failed-save retry and forbidden agent approval. React bindings would add another dependency if used. **Recommendation: approval is a reasonable next spike; install neither XState nor Effect globally in this PR.**

## Storybook implemented now

Storybook **10.6.3** with [React/Vite](https://storybook.js.org/docs/get-started/frameworks/react-vite) supports the existing React 19/Vite 8 toolchain. `.storybook` isolates builder config from the application's HTML transforms/proxy, retains the `@/` alias, and imports actual viewer styles and local fonts. A toolbar selects light/dark themes. No migration of existing Vitest or Playwright tests is needed.

`stories/Viewer.stories.tsx` exercises real loading/suite skeletons, host context fields, empty context, source links, a trusted plugin mount and its error fallback. `stories/Permissions.stories.tsx` exercises the actual modal and broker with an inert request: Deny/Allow update fixture status but never call a comment API. Recorded HTML is shown as text. These fixtures require no IAP, GCS, model or live replay API. The integration spec checks service independence, theme application and permission decisions.

Run `pnpm storybook`, `pnpm typecheck:storybook` and `pnpm build:storybook` in Boat. Addon-based visual regression, a published Storybook and broad interaction coverage are future work. This first slice does not add cloud publishing or duplicate the existing test runner.

## Decisions before expanding scope

1. Choose whether an optional Agent-Native host is wanted for embedded chat/history, or whether existing external MCP/browser agents suffice. The browser spike works in either case.
2. If choosing the full host, decide who operates PostgreSQL and maps auth identities/orgs; keep canonical replay objects in the existing pluggable store. Prototype one authenticated read action and one bounded agent run before migrating anything else.
3. Evaluate a draft-approval state machine before a global UI-state migration. Evaluate Effect on one server runner before changing public plugin interfaces. Each should earn adoption independently.

## Validation evidence

Boat, 25 October 2026: lint, scoped formatting, root typecheck, five focused WebMCP regressions, Storybook typecheck/build, viewer build, public library build, and optional example build/typecheck passed. An initially mis-forwarded Vitest filter also ran the existing suite: 1,379 passed, four skipped; subsequent runs used the explicit file filter. Three integration tests passed in one worker using the existing **Chromium 151.0.7922.108** binary with `--enable-features=WebMCP`: actual framework consumer against native WebMCP, consumer against the stand-in, and Storybook fixture/theme/permission checks with zero API requests. Each tool path inspected the replay, sought, surfaced an actionable invalid-input error, installed a draft, requested human Keep, and verified that the saved plugin list stayed empty. CI runs the same dedicated integration spec with its pinned Playwright browser; native support is a hard assertion, not a silent skip.

The repository-wide `format:check` encountered pre-existing nested root Biome configs under `.claude/worktrees/` on the box. Those unrelated worktrees were left intact; the changed files are checked explicitly.

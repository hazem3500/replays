# Replays: agent guide

Record browser sessions into portable replay bundles; capture with Node/CDP or the browser recorder, then serve and play them in a self-hosted React viewer.

## Before editing

Read the nearest area guide and [ownership map](docs/ownership.md). Fetch `origin/main`, scope the diff to your task, and preserve other agents' work. Never refactor an actively owned surface without coordinating with its owner.

## Architecture map

| Area | Responsibility | Import direction for new code |
| --- | --- | --- |
| `src/shared/` | Portable replay, edits, context and privacy contracts | No Node, React or environment-specific modules |
| `src/capture/` | Node/CDP capture, sanitizing, upload and CLI helpers | Shared contracts; injected recorder stays browser-safe |
| `src/server/` | HTTP, auth, storage, media rendering and host runtime | Shared, plugin/config APIs; never client or recorder |
| `src/plugin/`, `src/config/` | Public host-plugin API and configuration | Shared contracts and public plugin types |
| `src/first-party/` | IAP and GCS plugins | Public plugin API and shared contracts |
| `src/recorder/` | Browser-only recording, sanitizing, upload and default UI | Recorder modules and rrweb; no Node/server/client imports |
| `src/client/` | React viewer, editor, index and settings | Client/shared; no Node/server/capture imports |
| `src/client/components/ui/` | Base UI presentational primitives | UI primitives and `client/lib/utils.ts`; no app stores |
| `src/client/plugins/` | Browser extension API, registry and slot mounting | Public contracts; avoid feature implementation imports |
| `stories/`, `test/`, `e2e/` | Component states, logic/contracts, browser flows | Stories stay browser-only; tests may cross areas |
| `scripts/`, `tools/`, `budgets/` | Builds, quality reports, policy and ratchets | Development tooling only |

These directions govern new code; existing debt is measured separately. `.oxlintrc.json` enforces shared/client boundaries. See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/tooling.md](docs/tooling.md) for public setup.

## Commands: shared devbox

Installs, checks, builds, tests, browsers, Docker and dev servers run on the session's own Boat, never on oz-box. Use the actual T3 thread id; never borrow another thread's session.

```sh
oz-boat exec --session t3:<YOUR_THREAD_ID> -- pnpm install --frozen-lockfile
oz-boat exec --session t3:<YOUR_THREAD_ID> -- pnpm check
oz-boat exec --session t3:<YOUR_THREAD_ID> -- pnpm exec vp test run --config vitest.config.ts test/lint-policy.test.ts
oz-boat stop --session t3:<YOUR_THREAD_ID>
```

`check` runs lint, formatting, root typecheck, unit tests and app build. Also run relevant `typecheck:storybook`, `test:recorder`, `build:recorder`, `build:storybook`, `test:e2e`, `test:distro`, `test:pack` or `test:host-app`. `storybook` starts the story server. Read `package.json` for available scripts; do not invent a Storybook test command. Stop Boat at handoff.

## Fast feedback

On your own Boat, use `pnpm check:quick` for cached lint/format/tsrs types plus units affected by fetched `origin/main`. Run `pnpm test:changed` directly for that unit subset; `pnpm test:watch` and `pnpm typecheck:watch` keep feedback live. `pnpm dev` provides API + Vite HMR. Install the optional staged-only, read-only hook with `pnpm hooks:install`. Stop watch/server processes before stopping Boat.

`pnpm check` remains the full pre-handoff check; also run the relevant browser/example/Storybook checks. Root, Storybook, examples and declaration emission use pinned tsrs with reference defaults (`--fast false`). Type-aware lint retains the Oxlint backend until tsrs supports the same rules; see `docs/quality-tooling.md`. `pnpm build` and `pnpm build:cli` replay successful Vite Task results only while tracked inputs/environment match; `pnpm exec vp run --no-cache cached:build` forces a fresh viewer build. See [CI timings and tradeoffs](docs/ci-performance.md).

## CI

Open pull requests as drafts while iterating: CI and Code quality do not run on drafts, so run checks on your Boat. Mark the PR ready with `gh pr ready` when done and batch fixes into one push. CI reruns only the suites whose inputs changed since a passing run on this PR or on main; the weekly schedule and manual runs are full. A skipped job means identical inputs already passed. Bump `CACHE_VERSION` in `scripts/ci-scope.mjs` to force a full rerun everywhere. See [CI timings and tradeoffs](docs/ci-performance.md#round-2-run-only-what-changed-november-2026).

## Invariants

- Preserve privacy defaults, URL/header redaction and masking. Relevant coverage: `test/sanitize.test.ts`, `test/redaction.test.ts`, `test/capture-playwright.test.ts`, recorder sanitizer tests.
- Keep wire contracts in `src/shared/` and update their hand-written JSON Schemas in `docs/formats/` together. Schema generation is planned, not implemented.
- Server source runs with Node type stripping: preserve `erasableSyntaxOnly` and explicit `.ts` import extensions.
- Import the product name/slug from `src/shared/brand.ts`; host branding overrides live in `src/server/branding.ts`.
- Preserve public request ordering: request policy → pre-auth hooks → adapter auth routes → authentication/identity/scopes/CSRF → application authorization → post-auth hooks → plugin/core dispatch. Internal render routes have a separate loopback/token gate. See `test/plugin-app.test.ts`, `test/plugin-registry.test.ts` and `test/app.test.ts`.
- Storage keys go through `assertKey` in `src/server/storage/types.ts`; compare-and-swap writes must retain version conflict checks.
- Public API means `package.json` exports plus the documented contracts. Update `test/public-api.test.ts`, [API stability](docs/api-stability.md), extension docs and `CHANGELOG.md` when that surface changes.

## React and composition

### Icons and motion

Use the shared `AnimatedIcon` component for UI icons. Every interactive icon must have a purposeful animation on hover, keyboard focus, or a relevant state change, driven by Motion and the same control state for pointer and keyboard input. Extend the shared icon definitions when an icon is missing instead of adding a static icon directly to a control. Respect `prefers-reduced-motion`, keep icon geometry and spacing stable, and avoid continuous loops. Decorative and status icons remain still until a meaningful state change calls for motion. Apply this rule to new and modified controls, including menus, toolbars, dialogs, settings and recorder UI; use a browser-safe equivalent at the recorder boundary.

New code imports/calls effect hooks only in `src/client/hooks/`, the browser-only recorder adapter boundary `src/recorder/react/hooks/`, and story-local `stories/**/hooks/` fixtures; derive values during render, handle actions in event handlers, and subscribe through `useSyncExternalStore`. Use a named hook for imperative setup. Do not move browser-recorder code into the client to satisfy this rule.

React Compiler is enabled in the app build. Run `pnpm quality:compiler` on Boat for the [bailout report and build-parity status](docs/compiler-health.md). Do not add `useMemo`, `useCallback` or `memo`; an exception needs profiling evidence and a scoped `oxlint-disable-next-line ... -- why:`. Prefer `use(Context)`, ref props and small composable components; avoid `forwardRef`, `React.FC`, `defaultProps` and nested component definitions.

Keep files at most 400 lines; extract pure logic, then hooks, then views. Keep components focused, prefer children/slots over prop drilling, and render extensible lists from descriptors. Keep app data/navigation out of presentational components. Transport lives in `client/queries.ts` and the DB collections; navigation is TanStack Router (`client/routes/`, `client/router.tsx`, `client/routing/`; see [client routing](docs/architecture/client-routing.md)). Start work is separately owned; do not duplicate it.

## Comments

No narrating comments. Inside functions, JSX, trailing positions and standalone prose, use only `why:` or `invariant:` tags. TSDoc directly attached to declarations explains contracts and reasons, never restates the name. License headers and tool directives are allowed; every lint disable needs `-- why:`. Tag or delete with judgment; do not mechanically tag narration.

## Copy

No em or en dashes in user-visible copy; write ranges and asides in words. `replays/no-dash-in-copy` enforces it in strings, templates and JSX text; comments are exempt.

## Tests

Test public behavior and real failure modes. Mock only process boundaries (network, clock, filesystem, browser APIs), never our own modules. Mock client network calls with the shared MSW handlers in `test/msw/` (`setupMockApi`) instead of stubbing `fetch`; Storybook adopts them separately. Do not export private helpers just for tests. No snapshot-only tests, trivial getter/constant tests or type-shape tests. One behavior per `it`, named as a sentence. Logic goes in Vitest; UI behavior in story `play` or e2e; workflows in e2e. Ask: which mutant would this test kill? If none, remove it.

## Dependencies and files

A dependency must delete more hand-written code than the bytes it adds, have maintained typed ESM releases (normally within six months), pass the bundle budget, and avoid duplicating Base UI/TanStack/Effect primitives. Effect stays server-side; XState stays in the approval workflow.

Plugin contracts: `src/plugin/types.ts`, `src/client/plugins/api.ts`; slots: `src/client/plugins/registry.ts`; settings: `src/client/settings/`; theme: `src/client/styles.css`; stories: `stories/`; schemas: `docs/formats/`; ownership: `docs/ownership.md`. Consult the actual files before extending a pattern.

Do not edit build outputs under `dist/`, commit local transcripts/evidence, sweep-format unrelated code, weaken existing safety gates, or raise a baseline to hide new debt. Existing violations are report-only/baselined; added files must meet final rules. Credit Hazem only: no AI co-author trailers or generated-by text.

## Bundle budget changes

`budgets/bundle.json` owns bundle caps. Run builds and `pnpm quality:size` on your own Boat; commit its automatic cap decreases. Growth needs a specific `allowances` entry containing the stable file name, new metric caps, reason and current feature PR URL, reviewed with the measured main/head diff. Never raise `files` caps directly, reuse an old allowance, or refresh main from feature output. See [quality-tooling.md](docs/quality-tooling.md#reviewed-feature-growth). The gate stays blocking.

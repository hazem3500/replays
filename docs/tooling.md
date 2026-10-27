# Toolchain

The project pins `vite-plus` 1.4.0. Its local `vp` command supplies Vite 8.3.5, Vitest 5.0.5,
Oxlint 1.89.0, Oxfmt 0.74.0, oxlint-tsgolint 7.0.2004 and tsdown 0.23.1.
`pnpm exec vp --version` reports the installed versions. No global `vp` installation is required.
Node support is 22.22+ in 22.x, 24.11+ in 24.x, or 26+; CI and Docker use Node 22.23.4.

| Script | Tool / purpose |
| --- | --- |
| `pnpm build` | `vp build`, production viewer |
| `pnpm test` | `vp test run --config vitest.config.ts`, isolated unit/API suite |
| `pnpm test:recorder` | `vp test run --config vitest.recorder.config.ts`, happy-dom recorder tests |
| `pnpm lint` | `vp lint` with the existing base config, then type-aware shared-contract gate |
| `pnpm lint:types:audit` | Type-aware audit across the repository |
| `pnpm format` / `pnpm format:check` | `vp fmt` with explicit `.oxfmtrc.json` |
| `pnpm typecheck` | Pinned tsrs, same strict/erasable-syntax tsconfig and reference defaults |
| `pnpm check` | Lint, formatting, types, unit tests and viewer build |
| `pnpm dev` | Node server with API, storage/auth and Vite middleware/HMR |
| `pnpm build:cli` | Existing CLI/library/recorder bundling and declaration generation |
| `pnpm build:storybook` | Storybook with its isolated Vite config |

The explicit lint/formatter JSON configs preserve policy and editor configuration. Vite+ accepts `--config` for
both commands. The Vite alias points to `@voidzero-dev/vite-plus-core@1.4.0`; workspace overrides keep
transitive Vite/Vitest consumers aligned. The Agent-Native example explicitly provides these peers too. Direct Vitest remains for existing test imports and global types;
direct Oxlint remains for policy tests. Both match the versions bundled by Vite+.

The full project check deliberately remains broader than `vp check`. tsrs typechecking and declaration emission, Vite task caching and staged-only hooks are documented in
[CI performance](ci-performance.md). Rewriting every test import or replacing the library builders with `vp pack`
can be evaluated independently. The library's entry names, external dependencies, shared chunk identity,
recorder browser boundary and repaired declaration specifiers must survive any future pack migration.

Before merging a toolchain change, run on the session's Boat VM:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build:cli
pnpm typecheck:storybook
pnpm build:storybook
pnpm test:recorder
pnpm test:pack
```

Also start `pnpm dev`, verify `/` returns 200 and stop it. CI retains the example, packaging, browser and Docker
gates in addition to lint/format/types/unit/build/Storybook checks. Formatter output changes belong in a
separate commit; coordinate broad formatting passes with concurrent work.

References: [Vite+ migration rules](https://viteplus.dev/guide/migrate-rules),
[format](https://viteplus.dev/guide/fmt), [lint](https://viteplus.dev/guide/lint),
[test](https://viteplus.dev/guide/test), [pack](https://viteplus.dev/guide/pack).

## Request mocking

Unit tests that exercise client network code use [MSW](https://mswjs.io) through `test/msw/`. `setupMockApi(...shared)` starts
an interception server for one test file, resets per-test overrides after each test and fails any request without a handler
(`onUnhandledFrame: 'error'`), so a missing mock is a test failure rather than a real connection. `handlers.ts` holds one
builder per API route (`config`, `previewProbe`); add a builder there when a second test needs a route.
happy-dom files need `// @vitest-environment-options {"url": "http://localhost/"}` so relative `/api/...` URLs resolve.
Opt in per file: server integration tests keep talking to their own listeners. Storybook is not wired to MSW yet.

# Code quality tooling

The existing Vite+ 1.4 pipeline remains the required application check (`pnpm check`): Oxlint, its type-aware shared-contract pass, Oxfmt, TypeScript, tests and the viewer build. This rollout adds visibility without requiring a source cleanup. No `src/` files were changed.

The code inventories and package audits are **report-only**. Bundle budgets are a **blocking ratchet** with ceilings 3% above the first measured build. New runtime artifacts require explicit budgets. Tool crashes, malformed JSON, missing build outputs and build failures still fail the quality jobs.

## Commands and CI

Run these after `pnpm install --frozen-lockfile`. Build once with `pnpm build && pnpm build:cli` before the package and size checks. Rebuild the CLI before `pnpm check` on a warm checkout whose existing `dist/cli` may come from an older source revision; otherwise the bin smoke tests can compare current source help with an old binary. On oz-box, all installs, builds and checks must run in the coding session's own Boat box.

| Script | Configuration | CI job | Initial policy |
| --- | --- | --- | --- |
| `pnpm quality:knip` | `knip.json` | Quality / knip | Report unused files, exports, types, dependencies, binaries and unresolved references |
| `pnpm quality:boundaries` | `.dependency-cruiser.cjs` | Quality / boundaries | Report resolved layer violations and cycles |
| `pnpm quality:package` | `.attw.json`; publint `--strict` in `scripts/quality-package.mjs` | Quality / package | Pack once; audit that exact tarball with both validators |
| `pnpm quality:size` | **`budgets/bundle.json`**, schema alongside it | Quality / size | Block exceeded ceilings and unbudgeted runtime artifacts |
| `pnpm quality:dedupe` | pnpm's existing workspace/lockfile; `--check --ignore-scripts` | Quality / dedupe | Report deduplication opportunities without editing the lockfile |
| `pnpm quality:hooks` | `lefthook.yml` | Quality / hooks | Validate the hook configuration |
| `pnpm quality:test` | `scripts/quality-tooling.test.mjs` | Quality / test | Prove boundaries and budget enforcement with synthetic fixtures |

`pnpm quality` runs all checks after the build. Reports live in `.review-artifacts/quality/` (gitignored). CI uploads each audit's reports for 14 days on a best-effort basis and always prints the full reports to job logs. The initial CI run hit the account's Actions artifact-storage quota; only archive upload is non-blocking. Audit, build, test and budget steps retain their original gates. JSON, stderr and original exit statuses are retained; the size job also writes a per-file main/head comparison to its job summary. It uses read-only GitHub permissions and posts no comments.

## Initial inventory (2026-10-27)

Measured on Boat from `origin/main` **3435405 (PR #54 included)**, with the tooling-only changes in this PR. Findings are audit leads, not deletion instructions: check public consumers, side effects and tooling integrations before removing anything.

| Check | Findings |
| --- | --- |
| Knip 6.43.0 | **250**: 2 unused files, 1 runtime dependency, 3 devDependencies, 207 exports, 34 types, 1 unlisted dependency, 2 external binary references |
| dependency-cruiser 18.7.0 | **34**: 28 cycle reports (including type-only and dynamic-import edges), 2 client imports of server/capture source, 2 plugin implementation imports, 2 server runtime imports of client code; 0 unresolved imports |
| publint 0.3.25 | **0 errors/warnings**, 1 suggestion: consider an accurate `sideEffects` declaration |
| @arethetypeswrong/cli 0.18.5 | **0 failures for the ESM-only profile**; full report includes 10 legacy node10 no-resolution cases and 10 CJS-to-ESM cases outside the supported profile |
| size-limit / @size-limit/file 14.3.0 | **0 violations** across 55 runtime artifacts and 4 initial JS/CSS groups, each measured raw, gzip and Brotli (177 ceilings) |
| pnpm 10.33.3 dedupe | **0 deduplication opportunities**; existing Vite alias peer-version warnings remain informational |
| Lefthook 2.2.2 | **0 configuration errors** |

Knip's unused-file candidates are `src/client/components/ui/collapsible.tsx` and `separator.tsx`. The dependency candidate is `@opentelemetry/semantic-conventions`; devDependency candidates are the explicitly pinned `oxlint` and `oxlint-tsgolint`, plus `vitest` in `examples/agent-native`. Preserve toolchain pins until their intended use is reviewed. Storybook references the transitive `@storybook/builder-vite` without a direct declaration. `ffmpeg` and `ffprobe` are external executables used by the encoded-export smoke test, not npm dependencies.

Largest Knip file-level inventories: `src/client/ReplayIndex.tsx` (11), `src/shared/effects.ts` (8), `src/shared/edits.ts` (8), `src/shared/malleable.ts` (7); six each in `src/shared/replay.ts`, `src/client/viewer/Inspector.tsx`, `src/client/render/frames.ts` and `src/client/intent-prefetch.ts`.

The cross-layer findings are `src/client/upload/prepare.ts` importing `src/capture/human-bundle.ts`, plugin `index.ts` / `registry.ts` importing server `summary-fields.ts` / `branding.ts`, server `posters.ts` / `render-queue.ts` importing `src/client/render/frames.ts`, and a type reference in `src/client/config.ts` to `src/server/auth/types.ts`. Cycle reports cluster around `ReplayIndex` / `ReplayIndexCompact` / `FilterMenu`, `Viewer` / `navigation` / `intent-prefetch`, viewer inspector components, and shared contract types. A report counts a reported cycle edge/path, not a unique strongly connected component. Node-based co-located tests are deliberately excluded from the production browser rules.

### Current bundle measurements

All sizes below are bytes. Gzip uses level 9; Brotli uses quality 11. Shared files are counted once per initial group; each file is compressed separately before the sizes are summed, matching independent HTTP resources. These are transfer/footprint budgets, not runtime latency predictions.

| Artifact/group | Raw | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| Initial viewer JS (static dependency closure) | 1,167,788 | 369,953 | 296,335 |
| Initial viewer CSS | 196,699 | 34,585 | 29,472 |
| Initial render-page JS | 526,529 | 163,527 | 127,962 |
| Initial render-page CSS | 4,669 | 2,253 | 1,872 |
| rrweb player JS chunk | 299,590 | 92,253 | 66,414 |
| Editor JS chunk | 51,682 | 18,271 | 15,827 |
| Library recorder ESM (`rrweb` external) | 67,755 | 18,571 | 16,222 |
| CLI implementation | 339,987 | 86,943 | 71,673 |
| CLI bin shim | 1,511 | 720 | 605 |

The complete per-artifact limits are in `budgets/bundle.json`. This includes **every file** under emitted `dist/client`, `dist/lib`, `dist/cli` and `bin`: lazy JS and CSS, library entry points and shared chunks, both injected recorder copies, fonts, HTML and the bin shim. Build metadata is excluded from publishing and measurement. Declarations, documentation and replay samples are checked by the package audits rather than the runtime footprint gate. External npm dependencies are not rebundled into the server/CLI/library measurements; the browser assets include their bundled dependencies.

## Entries and architectural policy

Knip explicitly includes the server main/migration executable, CLI bin and source, every published library/recorder source entry, client HTML/JS entries, Storybook configuration/stories, example workspaces and standalone examples, scripts, unit tests, recorder tests and end-to-end tests. Public entry exports remain public; they are not treated as unused merely because this repository has no internal consumer. Vite/Vitest/Storybook/Playwright plugins add their discovered inputs. The declared wrapper-invoked tooling packages and CSS-only `tw-animate-css` are explicitly ignored as dependency false positives; helper declaration sidecars are excluded only from unused-file reporting. Oxc parser raw transfer is disabled through Knip's documented environment option so constrained CI workers do not need a huge virtual-memory buffer.

The boundary policy follows resolved paths, including aliases and re-exports:

- Shared contracts may depend on shared source, never other source layers or Node builtins.
- The browser-only recorder may depend on its own source and browser dependencies, never any other source layer, Node builtins or React/other UI frameworks.
- The client cannot import server, capture, server-plugin, config, first-party server plugins, MCP or CLI source, or Node builtins.
- Server code may use client type contracts but cannot load client implementation at runtime.
- Plugin contracts may reference environment type contracts but cannot load server/client/capture/recorder implementations at runtime.
- The CLI composes server/capture/library APIs, cannot depend on client code, and cannot be imported by library layers.
- Cycles include both runtime and type-only dependencies. `node_modules` edges are resolved but their internal graphs are not traversed.

Oxlint already has `import/no-cycle` and specifier-pattern restrictions. Dependency-cruiser earns the extra dependency because a single resolved graph can express this directory policy and distinguish runtime implementation from type-only contracts, including aliases, bare Node builtins and package export resolution. It validates its configuration schema when run. Existing strict Oxlint checks remain unchanged.

## Tightening and the bundle ratchet

For the inventories, use `QUALITY_STRICT=1 pnpm quality:knip`, `QUALITY_STRICT=1 pnpm quality:boundaries`, `QUALITY_STRICT=1 pnpm quality:package` or `QUALITY_STRICT=1 pnpm quality:dedupe` to preview a gate. Resolve or narrowly baseline each finding before setting `QUALITY_STRICT: '1'` on that CI job. Do not blanket-ignore `src/`. Review intentional type-only/dynamic cycles separately from runtime cycles. The JSON reporter's exit 0 does not hide dependency-cruiser violations: the wrapper also checks `summary.error`.

Bundle changes already block CI. Bundle ceilings have a single source of truth: `budgets/bundle.json`. Adjacent runtime vitals/interaction/server budgets may live in `performance-budget.config.mjs`; they should link this setup rather than duplicate bundle measurements.

After an optimization, rebuild and run:

```sh
pnpm build && pnpm build:cli
pnpm quality:size:ratchet
pnpm quality:size
```

`quality:size` automatically lowers each existing ceiling to `min(previous cap, ceil(current bytes × 1.03))`, removes budgets for deleted artifacts, and writes the result to `budgets/bundle.json`. `quality:size:ratchet` is an alias for the same operation. Neither command can bypass an over-budget result or allocate an unreviewed new chunk. Commit the automatic decreases with the optimization; CI uses `--check-ratchet` to require them without rewriting its checkout. CI demands a decrease only when head is smaller than the fresh main build measured on that same runner. Identical artifacts keep their caps, avoiding compression-version rounding noise; over-budget artifacts still fail.

### Reviewed feature growth

Caps only rise through a specific allowance in the budget file. Add an entry with the stable artifact name, only the metrics that need more room, a concrete reason, and the feature PR's full URL:

```json
{
  "file": "dist/client/assets/Inspector-HASH.css",
  "cap": { "raw": 29642 },
  "reason": "Mobile network search and request filters need the reviewed control styles.",
  "pr": "https://github.com/hazem3500/replays/pull/62"
}
```

Place entries in the top-level `allowances` array. Do not raise unrelated entries in `files`. Run `pnpm quality:size` after building; it applies the new allowance, keeps the 3% downward ratchet, and writes the resulting caps. Include gzip/Brotli caps as well if those metrics exceed their current ceilings. A new chunk needs all three metrics explicitly allocated. Do not add a broad wildcard or reset every cap.

The allowance is a review artifact: the maintainer reviews its reason and measured main/head delta in the feature PR. CI validates the metadata and requires each changed allowance to link the current PR. It compares caps against freshly fetched main's budget file, so a direct cap increase without a matching new allowance fails. An old allowance cannot be reused after an optimization. Replace its entry with a newly reviewed reason/cap/PR if the same metric needs more room later. The job summary includes a budget-diff table with the old/new cap, metric, reason and PR, alongside the existing measured byte deltas. No PR-comment write permission is needed.

For an already-stale main baseline, measure a clean main archive on Boat and land a baseline-only correction before feature allowances. Never absorb an unmerged feature into that correction.

Vite's native manifest supplies each entry's static dependency closure, including imported CSS. Dynamic imports are kept out of the initial group and budgeted per emitted file. Hashed client filenames normalize to stable logical names. Esbuild's shared library chunks use source-membership identities from its metafile, avoiding collisions between generic `chunk-HASH.mjs` filenames. The library build clears its generated chunks directory so old graph outputs cannot be packed or measured. A changed source-membership set is shown as a new/removed artifact rather than misattributed growth.

The size CI job builds a freshly fetched `origin/main` in a separate directory using the same runner and compression tool versions. It enables the Vite manifest and reruns the head's unchanged esbuild library options against **main's sources** solely to obtain source-membership metadata. The job summary lists raw/gzip/Brotli deltas for every file and initial group, including new/removed artifacts. Raw reports include the main measurement. No public PR comment permissions are needed.

## Fast pre-commit checks

On a developer workstation, opt in with `pnpm hooks:install`. No install lifecycle silently changes Git hooks. `pnpm quality:hooks` validates configuration in CI. The hook checks only staged file paths with Vite+'s existing Oxfmt and syntax-only Oxlint configuration. It does not run type-aware lint, builds, tests or audits, and it does not rewrite or restage files, preserving partial staging. CI's existing full lint/format jobs check the whole tree.

There is no commit-message hook: of the last 15 merged PR titles inspected, only one used Conventional Commits. Requiring it would introduce a new convention rather than enforce the repository's history.

## Curated scope

Added: Knip for dead-code/dependency inventories; dependency-cruiser for resolved architecture/cycles; publint and ATTW for complementary package/consumer-resolution checks; Size Limit's lightweight file plugin for Vite+/esbuild output budgets; Lefthook for staged feedback; pnpm dedupe because it adds a useful lockfile audit with no extra dependency.

Deferred: `type-coverage`/another `any` ratchet duplicates part of strict TypeScript, `no-explicit-any` and the existing type-aware audit, while adding a second compiler-based metric. Expand the existing type-aware scope as its violations are resolved. `actionlint`/`zizmor` are useful for a dedicated workflow-hardening pass, but would add a separate binary/Python toolchain and another baseline; this rollout's workflow uses read-only permissions and no secret-consuming PR steps. Renovate/Dependabot update grouping is deferred until an update cadence is chosen, particularly while Vite aliases and interdependent tooling pins are moving. No formatter/linter replacement, second bundler, browser-based size measurement, commitlint or automatic dependency churn was added.

## Upstream references

Versions were queried from the npm registry on 2026-10-27; exact versions are pinned in `package.json` and `pnpm-lock.yaml`. Configurations were checked against upstream docs and the installed validators:

- [Knip configuration](https://knip.dev/reference/configuration), [workspace scoping](https://knip.dev/features/monorepos-and-workspaces), [CLI and parser environment options](https://knip.dev/reference/cli).
- [Oxlint cycle rule](https://oxc.rs/docs/guide/usage/linter/rules/import/no-cycle.html), [dependency-cruiser rules and schema](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md), [resolver options](https://github.com/sverweij/dependency-cruiser/blob/main/doc/options-reference.md).
- [publint tarball CLI](https://publint.dev/docs/cli), [ATTW CLI profiles and JSON configuration](https://github.com/arethetypeswrong/arethetypeswrong.github.io/tree/main/packages/cli).
- [Size Limit file-plugin configuration](https://github.com/ai/size-limit), [Vite manifest static imports and CSS](https://vite.dev/guide/backend-integration.html).
- [Lefthook staged-file commands](https://lefthook.dev/configuration/run/), [pnpm dedupe check](https://pnpm.io/cli/dedupe).

## Verification

On the implementation thread's own Boat: frozen install; full `pnpm check` (**1,582 passed, 11 skipped**); library/recorder/CLI builds; every new quality script and hook installation/validation; two synthetic enforcement tests; and a fresh-main/head per-file size comparison. All new checks complete successfully with the findings above. Earlier stale CLI output was rebuilt before the successful full check; no source violations were fixed.

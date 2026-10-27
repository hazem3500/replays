# CI and local performance

Measurements use GitHub job/step timestamps and `/usr/bin/time` on this task's two-core Boat VM. They are wall times, not CPU times. Compare cold and warm states separately; do not count a skipped test as a faster test.

## Baseline, 27 October 2026

Sample: last 20 completed CI runs (main and pull requests), 16 successful. Cancelled/failed runs are retained in the sample but excluded from successful-duration medians. Eight related workflow runs supply PostgreSQL/quality timings. The median successful CI wall time, including queue time, was **301 seconds**. Job medians are not additive because jobs already ran independently.

| Job | Baseline median seconds | Slow steps (median seconds) |
| --- | ---: | --- |
| Lint and format | 34.5 | Node/store setup 15.5; install 5 |
| Typecheck | 48 | Root tsc 13.5; Storybook tsc 5 |
| Unit tests and build | 159 | Tests 107; viewer 11; package 7; host example 5 |
| End-to-end smoke | 263.5 | Tests + build 190.5; browser/deps 27; FFmpeg 23.5 |
| Custom distribution example | 144.5 | Packed consumer 52; browser/deps 35; viewer 9.5; package 6.5 |
| Agent-Native and Storybook | 111.5 | Browser/deps 36; viewer 12.5; package 8.5; stories 5.5 |
| Docker build and health | 115 | Build/load/cache export 91.5 |
| PostgreSQL identity | 52 | Container startup 14; tests 8 |
| Quality / package | 57 | Viewer + package 18 |
| Quality / size | 80 | Fresh main 26; head build 17 |
| Quality / boundaries, test, hooks, dedupe, knip | 32, 37, 27, 32, 33 | Node/store setup 10–14; commands 1–6 |

Quality has one successful sampled run per tool because #57 had just landed. Representative full baseline: [main CI 40509514938](https://github.com/hazem3500/replays/actions/runs/40509514938).

| Local command | Before seconds | After seconds | Conditions |
| --- | ---: | ---: | --- |
| pnpm install | 8.39 | 0.67 | Fresh dependencies vs existing dependencies/store; not a like-for-like flag speedup |
| pnpm lint | 2.42 | 0.44 | Warm quick-check cache; uncached full gate retained |
| Root typecheck | 10.62 | 2.53 | tsc 5.9.3 vs pinned native preview, same tsconfig |
| Full unit suite | 78.99 | 43.46 | Same 1,589 passes / 11 skips; isolated threads, two workers |
| Viewer build | 7.21 | 0.38 | Warm Vite Task content cache; first cached run 7.76 |
| Cached root native types | 10.62 | 0.38 | Warm quick-check cache; cold native 2.53 |
| Package build | 5.08 | 0.41 | Same CLI/library/recorder/declarations, warm cache |

## Changes and integrity

- pnpm's lockfile-keyed store cache and Docker buildx `type=gha,mode=max` cache already existed. Keep both; use frozen, prefer-offline installs everywhere. Docker already orders manifests/install before source in separate dependency, build and runtime stages. No paid runner size changes.
- Vitest uses two isolated thread workers. Global/environment mutation in existing tests makes `isolate:false` inappropriate. The full suite stays on every relevant PR, main and nightly; native affected-test selection is available locally. Thread tuning makes extra unit shards unnecessary for the critical path.
- Playwright runs all tests across three independent shards, retaining two workers per runner, retries, timeouts, FFmpeg and browser dependencies. Cache the exact lockfile's browser binaries; still run `install --with-deps` to provision/check host libraries. Keep shard-specific failure reports. Browser caches do not cache test results.
- Vite+ 1.4's `vp run` tracks file reads, directory listings, missing files and writes. Successful lint/format/type/build tasks can replay only when inputs match. Build-affecting environment variables are explicit. Library output directories are excluded from inputs because declaration repair intentionally reads and rewrites its own output. Raw `pnpm check` still runs the complete lint/format/types/tests gates; tasks that call external services are not result-cached.
- Root `typecheck` uses pinned `@typescript/native-preview`; Storybook retains TypeScript 5.9 because the native compiler reports undeclared CSS side-effect imports there. `pnpm typecheck:tsc` remains available for compatibility diagnosis; declaration emission still uses TypeScript 5.9. Native failures are never swallowed.
- On PRs only, root/docs Markdown can skip runtime jobs; Storybook-only changes retain lint, root/Storybook typechecks and Agent-Native/Storybook integration. Schema JSON, unknown paths, source, dependencies and workflow changes run all checks. Empty/unknown diffs fail conservatively; missing git history fails the scope job. Main, scheduled and manual CI always run everything.
- Existing required check names `Unit tests and build`, `End-to-end smoke` and `PostgreSQL identity and credentials` remain aggregate checks. They require successful work or an explicit scope-selected skip. `CI status` validates the remaining CI jobs. Matrix jobs use `fail-fast:false`. Failures/cancellations cannot become successful aggregates. Workflow concurrency already cancelled superseded PRs; it remains enabled.
- All seven Quality jobs, package smoke, host/custom-distro integrations, PostgreSQL coverage and performance/report-only workflows remain intact. Unit tests and build now run independently.

## Local loop

Run these on your session's Boat. `pnpm check:quick` caches lint/format/types and runs `test:changed` against fetched `origin/main`; it is a feedback loop, not a replacement for `pnpm check` before handoff. `pnpm test:watch` watches units; `pnpm typecheck:watch` watches native TypeScript; `pnpm dev` serves API + Vite HMR. Lefthook from #57 already checks only staged paths, in parallel, without rewriting or restaging: opt in with `pnpm hooks:install`.

## Costs and further options

Three E2E shards trade repeated setup and additional runner minutes for lower elapsed time. Keep the existing Ubicloud runner sizes. Extra unit shards, larger paid runners and a maintained browser/FFmpeg container should be reconsidered only against measured post-change bottlenecks. A prebuilt container saves apt work but adds image transfer, registry/storage and update maintenance; do not substitute system Chrome for the locked Playwright revision. PR-only `--changed`/`--only-changed` selection is deferred because dynamic imports, spawned CLI processes and filesystem fixtures are not a proven complete dependency graph here. Full PR coverage is preserved.

Upstream: [Vite task caching](https://viteplus.dev/guide/cache), [Vite Actions cache](https://viteplus.dev/guide/github-actions-cache), [Vitest worker isolation](https://vitest.dev/guide/improving-performance), [native TypeScript preview](https://github.com/microsoft/typescript-go/tree/main/_packages/native-preview).

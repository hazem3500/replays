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
| Root typecheck | 11.09 | 0.75 | tsc 5.9.3 vs tsrs 0.20 beta; intermediate tsgo 2.51 |
| Full unit suite | 78.99 | 43.46 | Same 1,589 passes / 11 skips; isolated threads, two workers |
| Viewer build | 7.21 | 0.38 | Warm Vite Task content cache; first cached run 7.76 |
| Cached root types | 10.62 | 0.38 | Intermediate native-cache measurement; final tsrs measured below |
| Package build | 5.08 | 0.51 | Final single-task cache restores complete CLI/library/recorder/declarations |

The final verification after rebasing #60 passed 1,629 unit tests (11 skipped) in 58.30 seconds plus all 68 recorder tests. That expanded suite is not a like-for-like comparison with the earlier 1,589-test thread experiment.

## Real CI comparison

The first green speed-PR run is [40516163044](https://github.com/hazem3500/replays/actions/runs/40516163044), head `3da28b2`. All seven Quality jobs and PostgreSQL also passed. Critical path here means run creation through the last job completion; run `updatedAt` may move later when GitHub refreshes metadata. The baseline median on that definition is **300 seconds** (301 using `updatedAt`); the first cold PR run is **250 seconds**, 17% lower, with an expanded unit suite.

| Job / execution step | Historical median seconds | First green cold run seconds |
| --- | ---: | ---: |
| Critical path | 300 | 250 |
| Lint and format | 34.5 | 41 |
| Typecheck job | 48 | 41 |
| Root + Storybook typecheck commands | 18.5 | 2 |
| Unit execution | 107 | 61 |
| Unit job | 159 including build/host | 97; independent build/host 52 |
| E2E job / longest shard | 263.5 | 201 (other shards 141, 141) |
| E2E test/build step / longest shard | 190.5 | 107 (other shards 66, 49) |
| Custom distribution | 144.5 | 137 |
| Agent-Native and Storybook | 111.5 | 100 |
| Docker build + health job | 115 | 220 |

The cold install steps took 5–14 seconds while repopulating the new lockfile's pnpm cache. Docker's build step took 194 seconds, including 78.6 seconds exporting the new GHA cache and 37.7 seconds exporting/loading the image. That initial cache population is a regression versus the mixed historical median and is retained in the table. The packed-consumer test still took 53 seconds before its npm cache was populated. The next green run, [40518098412](https://github.com/hazem3500/replays/actions/runs/40518098412), exercised warm infrastructure caches on `c09c33a`. Its critical path was 263 seconds: faster tasks were offset by runner queues and the extra aggregate level. This is retained rather than claiming the warm run was faster overall. The final workflow uses the existing required `End-to-end smoke` name for the single final aggregate, directly depending on the work jobs.

| Job | Baseline seconds | Warm run seconds |
| --- | ---: | ---: |
| Lint and format | 34.5 | 33 |
| Typecheck | 48 | 37 |
| Unit execution | 107 | 71 |
| Unit job / independent build and host | 159 combined | 100 / 40 |
| E2E / longest shard | 263.5 | 159 (other shards 124, 127) |
| Custom distribution | 144.5 | 122 |
| Agent-Native and Storybook | 111.5 | 82 |
| Docker build and health | 115 | 122 |
| PostgreSQL test job | 52 | 42 (plus scope 10 and aggregate 6) |
| Quality / package | 57 | 51 |
| Quality / size | 80 | 95 |
| Quality / boundaries, test, hooks, dedupe, knip | 32, 37, 27, 32, 33 | 37, 38, 30, 44, 39 |

Warm browser setup took 12–21 seconds versus 26–31 seconds cold. The unit suite is larger than the historical sample. The npm cache / prefer-offline trial did not make the consumer smoke meaningfully faster: 50 seconds versus 53 cold. Both trial changes were removed from the final implementation; preserve independent npm-consumer coverage and retain this as a remaining bottleneck. Quality's fresh-main build and report jobs remain unchanged gates; their startup variability is visible in the table.

## Changes and integrity

- pnpm's lockfile-keyed store cache and Docker buildx `type=gha,mode=max` cache already existed. Keep both; use frozen, prefer-offline installs everywhere. Docker already orders manifests/install before source in separate dependency, build and runtime stages. No paid runner size changes.
- Vitest uses two isolated thread workers. Global/environment mutation in existing tests makes `isolate:false` inappropriate. The full suite stays on every relevant PR, main and nightly; native affected-test selection is available locally. Thread tuning makes extra unit shards unnecessary for the critical path.
- Playwright runs all tests across three independent shards, retaining two workers per runner, retries, timeouts, FFmpeg and browser dependencies. Cache the exact lockfile's browser binaries; still run `install --with-deps` to provision/check host libraries. Keep shard-specific failure reports. Browser caches do not cache test results.
- Vite+ 1.4's `vp run` tracks file reads, directory listings, missing files and writes. Successful lint/format/type/build tasks can replay only when inputs match. Build-affecting environment variables are explicit. Package generation runs as one task that rebuilds and repairs all declarations; its output directories are excluded from inputs because repair intentionally reads and rewrites that same task's output. Repair is never independently cached, so a new source declaration cannot be overwritten by a stale repair result. Raw `pnpm check` still runs the complete lint/format/types/tests gates; tasks that call external services are not result-cached.
- Root, Storybook, example typechecks and library/recorder declaration emission use pinned tsrs reference defaults. Storybook includes the existing CSS ambient declaration; Agent-Native explicitly includes installed Node types. All compiler error codes in the negative parity probe match tsc and tsgo; no diagnostics are suppressed. See [compiler parity and fallback scope](quality-tooling.md#tsrs-compiler-adoption).
- On PRs only, root/docs Markdown can skip runtime jobs; Storybook-only changes retain lint, root/Storybook typechecks and Agent-Native/Storybook integration. Schema JSON, unknown paths, source, dependencies and workflow changes run all checks. Empty/unknown diffs fail conservatively; missing git history fails the scope job. Main, scheduled and manual CI always run everything.
- Existing required check names `Unit tests and build`, `End-to-end smoke` and `PostgreSQL identity and credentials` remain aggregate checks. They require successful work or an explicit scope-selected skip. `End-to-end smoke` also validates all remaining CI jobs directly, without a second aggregate level. Matrix jobs use `fail-fast:false`. Failures/cancellations cannot become successful aggregates. Workflow concurrency already cancelled superseded PRs; it remains enabled.
- All seven Quality jobs, package smoke, host/custom-distro integrations, PostgreSQL coverage and performance/report-only workflows remain intact. Unit tests and build now run independently.

## Local loop

Run these on your session's Boat. `pnpm check:quick` caches lint/format/types and runs `test:changed` against fetched `origin/main`; it is a feedback loop, not a replacement for `pnpm check` before handoff. `pnpm test:watch` watches units; `pnpm typecheck:watch` watches tsrs; `pnpm dev` serves API + Vite HMR. Lefthook from #57 already checks only staged paths, in parallel, without rewriting or restaging: opt in with `pnpm hooks:install`.

## Artifact storage

On 27 October the repository artifact API listed 13 run artifacts (all Docker build records from 14–16 October), totaling 701,227 bytes (0.67 MiB). Listed first, then deleted only those older than three days; the follow-up inventory returned zero artifacts/zero bytes. No releases or caches were touched. Account-wide billing storage was unavailable to the current token (404, missing `user` scope), so repository storage is not a claim about account usage.

Evidence uploads are best-effort, ignore missing files and retain reports for three days. Already-compressed browser traces/package tarballs use compression level 0; text quality reports use 6. Optional Docker build-record uploads are disabled; Docker's build summary remains enabled. Size/budget tables are already emitted to the job summary before the gate returns its failure status. Upload failures cannot hide gate failures.

## Costs and further options

This repository is private (verified through the repository API). Standard GitHub-hosted Linux runners provide two cores for private repositories and consume the account allowance, then list $0.006/min; they are not a free four-core upgrade ([GitHub runner reference](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job), [pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)). GitHub's larger 8-core Linux runner lists $0.022/min and is always paid ([pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)). Ubicloud's current page lists standard 4-core at $0.0025/min, premium 4-core at $0.004/min and standard 8-core at $0.005/min; verify account/region pricing before a switch ([Ubicloud](https://www.ubicloud.com/use-cases/github-actions)). No paid runner switch was made.

Three E2E shards trade repeated setup and additional runner minutes for lower elapsed time. Keep the existing Ubicloud runner sizes. Extra unit shards, larger paid runners and a maintained browser/FFmpeg container should be reconsidered only against measured post-change bottlenecks. A prebuilt container saves apt work but adds image transfer, registry/storage and update maintenance; do not substitute system Chrome for the locked Playwright revision. PR-only `--changed`/`--only-changed` selection is deferred because dynamic imports, spawned CLI processes and filesystem fixtures are not a proven complete dependency graph here. Full PR coverage is preserved.

Upstream: [Vite task caching](https://viteplus.dev/guide/cache), [Vite Actions cache](https://viteplus.dev/guide/github-actions-cache), [Vitest worker isolation](https://vitest.dev/guide/improving-performance), [native TypeScript preview](https://github.com/microsoft/typescript-go/tree/main/_packages/native-preview).

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

The cold install steps took 5–14 seconds while repopulating the new lockfile's pnpm cache. Docker's build step took 194 seconds, including 78.6 seconds exporting the new GHA cache and 37.7 seconds exporting/loading the image. That initial cache population is a regression versus the mixed historical median and is retained in the table. The packed-consumer test still took 53 seconds before its npm cache was populated. The next green run, [40518098412](https://github.com/hazem3500/replays/actions/runs/40518098412), exercised warm infrastructure caches on `c09c33a`. Its critical path was 263 seconds: faster tasks were offset by runner queues and the extra aggregate level. This is retained rather than claiming the warm run was faster overall. That workflow ended in a single final aggregate job; round 2 removed it (see below).

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

The rebased CI with the single final aggregate, [40520210037](https://github.com/hazem3500/replays/actions/runs/40520210037), passed in **242 seconds** (19% below the 300-second median). Unit and E2E jobs passed; Docker took 198 seconds while rebuilding against the newer main. Its separate Quality run correctly required four one-byte downward budget ratchets under the newly merged policy; no measurement exceeded a cap. Those generated reductions are committed. The rebased local full suite passed **1,645 tests / 11 skipped** in 56.79 seconds, and all 11 quality enforcement fixtures plus four scope fixtures passed.

These are individual after runs against a historical median, with changing source and queue conditions; they demonstrate command/job improvements rather than a statistical latency guarantee. Detailed warm job values above retain regressions as well as wins.

## Changes and integrity

- pnpm's lockfile-keyed store cache and Docker buildx `type=gha,mode=max` cache already existed. Keep both; use frozen, prefer-offline installs everywhere. Docker already orders manifests/install before source in separate dependency, build and runtime stages. No paid runner size changes.
- Vitest uses two isolated thread workers. Global/environment mutation in existing tests makes `isolate:false` inappropriate. The full suite stays on every relevant PR, main and the weekly scheduled run; native affected-test selection is available locally. Thread tuning makes extra unit shards unnecessary for the critical path.
- Playwright runs all tests across three independent shards, retaining two workers per runner, retries, timeouts, FFmpeg and browser dependencies. Cache the exact lockfile's browser binaries; still run `install --with-deps` to provision/check host libraries. Keep shard-specific failure reports. Browser caches do not cache test results.
- Vite+ 1.4's `vp run` tracks file reads, directory listings, missing files and writes. Successful lint/format/type/build tasks can replay only when inputs match. Build-affecting environment variables are explicit. Package generation runs as one task that rebuilds and repairs all declarations; its output directories are excluded from inputs because repair intentionally reads and rewrites that same task's output. Repair is never independently cached, so a new source declaration cannot be overwritten by a stale repair result. Raw `pnpm check` still runs the complete lint/format/types/tests gates; tasks that call external services are not result-cached.
- Root, Storybook, example typechecks and library/recorder declaration emission use pinned tsrs reference defaults. Storybook includes the existing CSS ambient declaration; Agent-Native explicitly includes installed Node types. All compiler error codes in the negative parity probe match tsc and tsgo; no diagnostics are suppressed. See [compiler parity and fallback scope](quality-tooling.md#tsrs-compiler-adoption).
- Which checks run is decided by Turborepo task inputs and, for the browser-backed suites, by event, label, risky paths and content-addressed input hashes; see [round 3](#round-3-one-gate-job-and-turborepo-november-2026) and [round 2](#round-2-run-only-what-changed-november-2026). The weekly scheduled run and manual CI always run everything.
- No required status checks are configured: the repository is private on the free plan, where the branch protection and rulesets APIs return 403. The former aggregate jobs `Unit tests and build`, `End-to-end smoke` and `PostgreSQL identity and credentials` therefore only cost minutes and were removed in round 2. A failing step fails its work job, and that job's red check is the gate. Matrix jobs use `fail-fast:false`. Workflow concurrency cancels superseded PR runs.
- All seven Quality jobs, package smoke, host/custom-distro integrations, PostgreSQL coverage and performance/report-only workflows remain intact.

## Round 2: run only what changed (November 2026)

Ubicloud bills each job separately, rounded up to whole minutes, so a job costs at least one minute and every repeated checkout, install and browser setup is paid again. A full pull-request run billed about 48 minutes in CI across 17 jobs plus about 3 in Code quality. Round 2 cuts that in three ways without dropping a gate.

**Triggers.** CI and Code quality run on `opened`, `synchronize`, `reopened` and `ready_for_review`, with a path filter on pull requests and on pushes to main: changes that only touch root Markdown, `docs/**/*.md` (except `docs/tokens.md`, which `scripts/theme-contract.mjs` reads), `docs/screenshots/`, issue and pull request templates, `CODEOWNERS` or `LICENSE` start no run. Draft pull requests run nothing: the first job of each workflow is skipped and every other job depends on it. The weekly schedule and manual dispatch are unchanged.

**Fewer jobs.** Five work jobs replace fifteen, each with one install. Steps after install run with `!cancelled()` and their real dependencies, so one failing check still reports the others.

| Suite | Job | Gates | Inputs excluded from its hash (besides the common set) |
| --- | --- | --- | --- |
| `checks` | Lint, types, unit tests and build | Lint, format, ratchets, override check, final rules for added files, root and Storybook typecheck, unit tests, PostgreSQL tests, viewer/library build, host application | None (keeps `docs/tokens.md`; `budgets/bundle.json` stays because format check reads it) |
| `e2e` | End-to-end (1/3, 2/3, 3/3) | All Playwright specs; shard 3 also runs the single-page-app subset | `budgets/`, unit tests (`test/**/*.test.ts`, `src/**/*.test.ts(x)`), `stories/`, `.storybook/`, the custom-distro, composed-viewer, Agent-Native and host-app examples, `site/`, Vitest configs, lint/format/hook/knip/Stryker/dependency-cruiser configs, `scripts/*.test.mjs` |
| `browser` | Recorder, render, plugins, distribution and Agent-Native | Recorder tests, real render, plugin browser check, packed tarball, custom distro build/typecheck/Playwright, composed viewer check/Playwright, Agent-Native check, Storybook build and Agent-Native tests | `budgets/`, `e2e/`, `playwright.config.ts`, `site/`, mutation Vitest config, lint/format/hook/knip/Stryker/dependency-cruiser configs, `scripts/*.test.mjs`, unit tests under `test/` other than `render.integration.test.ts` and `plugin-check-browser.test.ts`, which the job runs (keeps `docs/tokens.md`) |
| `docker` | Docker build (not pushed) | Image build and health check | `budgets/`, `e2e/`, `test/`, `stories/`, `.storybook/`, `src/client/` except `src/client/render/frames.ts`, `src/recorder/`, `src/**/*.test.ts(x)`, `site/`, Playwright and Vitest configs, lint/format/hook/knip/Stryker/dependency-cruiser configs |

The common set excluded from every suite is root `*.md`, `docs/**/*.md`, `docs/screenshots/`, the GitHub issue/PR templates and `CODEOWNERS`, `LICENSE`, and the workflow files other than `ci.yml`. `ci.yml`, `.github/actions/` and `scripts/ci-scope.mjs` stay in every suite, so any CI change reruns everything. The Docker suite drops the client because the client build is already proven by the `checks` suite; the runtime image copies only `frames.ts` from it.

**Reuse.** `scripts/ci-scope.mjs` hashes, per suite, `git ls-files -s` (mode, blob id and path) of the tracked tree minus the suite's exclusions, salted with `CACHE_VERSION`, the suite name and the pinned Node version. The scope job looks up a pass marker `ci-pass-v1-<marker>-<hash>` in the Actions cache for each of `checks`, `e2e-1`, `e2e-2`, `e2e-3`, `browser` and `docker` (lookup only, nothing is downloaded). A hit skips that job or shard; a miss runs it, and a job that passes saves its marker through `.github/actions/remember-pass`. Each end-to-end shard has its own marker, so rerunning one flaky shard does not rerun the others. The job summary lists every key and whether its suite ran or was reused.

Limits:

- Cache entries expire after 7 days without use, after which the suite simply runs again.
- Markers live in Ubicloud's transparent Actions cache, which is shared across branches (GitHub's own cache would scope it per ref). A marker saved by any pull request or by main is reusable everywhere, so main reuses the pull request's passes when the merged tree is identical to the last tested merge commit. Anyone who can push a branch can therefore write a marker that main trusts; that is acceptable only while every pusher is a trusted collaborator of this private repository. Revisit before accepting outside contributors (bump `CACHE_VERSION` and scope keys by ref).
- The hash covers tracked inputs and the Node version only. Runner image, apt packages, registry state and service images can drift without changing it; the weekly scheduled run and manual runs ignore markers and run everything to catch that. Bump `CACHE_VERSION` to invalidate every marker at once.
- Exclusions are a reviewed claim that a suite never reads those paths. When a suite starts reading a new path, check `SUITES` and its fixture tests in `scripts/ci-scope.test.mjs`.

Measured on #207 (billed minutes = sum over jobs of whole started minutes; CI plus Code quality):

| Push | CI | Code quality | Total | Before |
| --- | ---: | ---: | ---: | ---: |
| Full run (CI or dependency change, or main moved) | 29–35 | 3–4 | 32–39 | ~51 |
| Viewer-only change | 28 | 4 | 32 | ~51 |
| Unit-test-only change | 7 | 3 | 10 | ~51 |
| Documentation added to a code pull request | 1 | 4 | 5 | ~10 |
| Identical inputs again (revert, re-push) | 1 | 3 | 4 | ~51 |
| Documentation-only pull request, or a draft | 0 | 0 | 0 | ~10 |
| Push to main after merging an up-to-date pull request | 1 | — | 1 | ~48 |

Six of the 29–35 minutes of a full run are setup; the floor is the three end-to-end shards (16–19 minutes).

## Round 3: one Gate job and Turborepo (November 2026)

Round 3 targets a typical pull request push under 5 billed minutes. Round 2's floor was the end-to-end shards, so they leave the per-PR gate, and the remaining checks become one cached job.

**One Gate job.** The `checks` job and the separate Code quality workflow become one `Gate` job on `ubicloud-standard-2`. It runs every check as a root Turborepo task (`turbo.json`): lint, format, root and Storybook typecheck, unit tests, PostgreSQL tests, viewer and package builds, the lint ratchet and its tests, final rules for added files, and the knip, boundaries, dedupe, hooks, test-quality, package and size audits. Each task declares its inputs and outputs. Pull requests add `--affected` against the base commit (`TURBO_SCM_BASE`, with `affectedUsingTaskInputs`), so a task whose inputs did not change is not scheduled at all. Every task result is stored in the shared remote cache (`TURBO_API`, `TURBO_TEAM`, secret `TURBO_TOKEN`), so a task whose exact inputs passed anywhere (another branch, main or a Boat) replays its logs and outputs instead of running. The job summary lists each task's cache status; `.turbo/runs/` is uploaded as `gate-reports`.

**Browser suites run on main and nightly only.** End-to-end shards, the browser job (recorder, real render, plugin browser check, packed tarball, distro, composed viewer, Agent-Native, Storybook build) and Docker run on main pushes and the daily schedule. Manual smoke runs must also target main. Pull request paths and labels never start these jobs. Smoke selection runs independently from Gate, so browser coverage can start while main's unit and quality checks run.

Main pushes reuse exact-input pass markers. Every nightly run ignores markers and executes all suites to catch runner, browser and dependency drift. The blocking PR Gate retains its lint, types, affected units, builds and quality audits. Unit task hashes exclude bundle budgets, stories and landing-page inputs: the separate quality, Storybook and site checks own those inputs. Unit source, configuration, helpers, scripts and dependencies still invalidate them.

**A red main is loud.** The `Main health` job runs after every main or scheduled run. If any job failed, it fails too and opens, or comments on, the `CI is failing on main` issue; the next green run comments and closes it. Fix forward on a new pull request.

**Removed or moved checks.**

| Check | Now | Reason |
| --- | --- | --- |
| End-to-end shards 1 to 3 and the single-page-app subset | main and nightly | Browser coverage runs after integration; the PR Gate keeps units, types and builds |
| Browser job (recorder, render, plugin, tarball, distro, composed viewer, Agent-Native, Storybook build) | same | 6 to 7 billed minutes of browser and packaging work |
| Docker build and health check | same | Main checks the runtime image; nightly also catches environment drift |
| `typecheck:overrides` (compiler API pass, 21 seconds) | `pnpm typecheck` | Its baseline was empty; `noImplicitOverride` in `tsconfig.json` makes tsrs report the same TS4114 error |
| Code quality workflow and its fresh main build | Gate tasks | Same audits, one install; main's bundle sizes are a cached `quality:size:base` task |

**Unit tests for affected code.** On pull requests the unit suite runs as `test:affected`: Vitest `--changed` against the base commit runs only the test files whose module graph reaches a changed file, and Vitest reruns everything when `package.json` or a Vite or Vitest config changes. Main, nightly and the weekly run keep the full `test` task. The [deferred risk](#costs-and-further-options) still applies: a test that reaches code only through a spawned CLI process or a filesystem fixture can be skipped on a pull request. Main's full suite then catches it, and the main-health issue makes that failure visible. The unit suites run after the other tasks, alone on the runner: on the first cold run five tests with 5 second timeouts timed out while builds shared the two cores.

`src/client/route-tree.gen.ts` is left out of every task's inputs. The viewer and start builds both regenerate it, with different content, so a build in the same run used to change the hash of every later task; it is derived from `src/client/routes/`, the Vite configs and the lockfile, which stay inputs.

No tool was swapped: lint (Oxlint), format (Oxfmt), types (tsrs) and tests (Vitest) were already the fast native tools, and Turborepo adds caching around them.

Measured on #212 (billed minutes = sum over jobs of whole started minutes, all on `ubicloud-standard-2`):

| Push | Jobs (billed) | Billed | Wall |
| --- | --- | ---: | ---: |
| Round 2 viewer-only change, for comparison | scope, checks, three shards, browser, Code quality | 32 | about 7 min |
| Draft | none | 0 | 0 |
| Cold cache, every task runs (`turbo.json` changed) | Gate 5; suites reused their pass markers | 5 | 4 min 23 s |
| Cold cache plus the browser suites (dependency files are risky paths) | Gate 7, end-to-end 8, 6, 7, browser 5, Docker 5 | 38 | 14 min |
| Same inputs again (empty commit) | Gate 1: 34 of 34 tasks `cache hit, replaying logs` | 1 | 56 s |

In the cold Gate run, the 25 non-unit tasks took 87 seconds at concurrency 2 (build 55, size baseline 41, lint ratchet 16, dedupe 12). The full unit suite took 113 seconds alone, and PostgreSQL 7. Setup, install and reports add about 50 seconds. Typical pushes (runtime change, unit-test-only change, documentation) were probed on a separate pull request after the merge, because every push to #212 changed the dependency files and so ran the browser suites.

Probes after #218 (pull request #215): a one-package server change billed 4 (Gate 184 s: build 44 s and the affected units 60 s dominate), a unit-test-only change 2 (96 s), a documentation-only change 0 (no run starts), and an empty re-push 1 (57 s, 23 of 24 tasks replayed). In the warm run about 40 s was fixed setup, so the Gate now starts PostgreSQL in the background instead of as a service container (the service made every run wait about 12 s first), uploads its reports only on failure (about 4 s) and runs the suite selector's own tests only when the selector or workflows change (about 2 s).

## Local loop

Run these on your session's Boat. `pnpm check:quick` caches lint/format/types and runs `test:changed` against fetched `origin/main`; it is a feedback loop, not a replacement for `pnpm check` before handoff. `pnpm test:watch` watches units; `pnpm typecheck:watch` watches tsrs; `pnpm dev` serves API + Vite HMR. Lefthook from #57 already checks only staged paths, in parallel, without rewriting or restaging: opt in with `pnpm hooks:install`.

## Artifact storage

On 27 October the repository artifact API listed 13 run artifacts (all Docker build records from 14–16 October), totaling 701,227 bytes (0.67 MiB). Listed first, then deleted only those older than three days; the follow-up inventory returned zero artifacts/zero bytes. No releases or caches were touched. Account-wide billing storage was unavailable to the current token (404, missing `user` scope), so repository storage is not a claim about account usage.

Evidence uploads are best-effort, ignore missing files and retain reports for three days. Already-compressed browser traces/package tarballs use compression level 0; text quality reports use 6. Optional Docker build-record uploads are disabled; Docker's build summary remains enabled. Size/budget tables are already emitted to the job summary before the gate returns its failure status. Upload failures cannot hide gate failures.

## Costs and further options

This repository is private (verified through the repository API). Standard GitHub-hosted Linux runners provide two cores for private repositories and consume the account allowance, then list $0.006/min; they are not a free four-core upgrade ([GitHub runner reference](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job), [pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)). GitHub's larger 8-core Linux runner lists $0.022/min and is always paid ([pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)). Ubicloud's current page lists standard 4-core at $0.0025/min, premium 4-core at $0.004/min and standard 8-core at $0.005/min; verify account/region pricing before a switch ([Ubicloud](https://www.ubicloud.com/use-cases/github-actions)). No paid runner switch was made.

Three E2E shards trade repeated setup and additional runner minutes for lower elapsed time. Keep the existing Ubicloud runner sizes. Extra unit shards, larger paid runners and a maintained browser/FFmpeg container should be reconsidered only against measured post-change bottlenecks. A prebuilt container saves apt work but adds image transfer, registry/storage and update maintenance; do not substitute system Chrome for the locked Playwright revision. Dynamic imports, spawned CLI processes and filesystem fixtures are not a proven complete dependency graph here, so `--changed` selection can miss a test. Round 2 kept the full suite on pull requests for that reason; round 3 accepts the risk on pull requests only, with the full suite on main, nightly and weekly.

Upstream: [Vite task caching](https://viteplus.dev/guide/cache), [Vite Actions cache](https://viteplus.dev/guide/github-actions-cache), [Vitest worker isolation](https://vitest.dev/guide/improving-performance), [native TypeScript preview](https://github.com/microsoft/typescript-go/tree/main/_packages/native-preview).

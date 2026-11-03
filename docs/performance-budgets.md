# Runtime performance budgets

`budgets/runtime.mjs` sits beside the canonical bundle-size budget `budgets/bundle.json`. The root `performance-budget.config.mjs` remains a compatibility export for existing harness commands. The runtime job is **report-only**: numeric overruns are warnings; build failures, harness errors, missing required pages, and incomplete samples fail the job. Bundle bytes are owned by the separate size-limit job.

Run on Boat (never oz-box):

```sh
oz-boat exec --session t3:<your-thread> -- bash -lc 'pnpm install --frozen-lockfile && pnpm exec playwright install chromium && pnpm build && node --test scripts/perf/model.test.mjs && node scripts/perf/run.mjs && node scripts/perf/report.mjs'
```

`PERF_SAMPLES=1` is useful for harness development, but cannot establish a baseline. Normal runs take three cold-context samples per page/profile, serially, and retain their median. `PERF_OUTPUT` selects the artifact directory. Boat sync keeps the remote Git metadata: set `PERF_REVISION` to the local source SHA when using Boat so the report identifies the measured source accurately; CI checkouts already carry the correct SHA. CDP disables HTTP cache and applies 4× CPU plus 150 ms latency / 1.6 Mbps down / 750 kbps up for the synthetic phone. Desktop uses the same Chrome without throttling. All samples record the runner CPU, visible core count, memory, Node and Chrome version; a 2-core/4-GB Boat result is not comparable to a different runner. The app forces list layout on phones: the grid scenario keeps a desktop viewport with the phone's CPU/network to exercise actual grid code.

The harness launches a production server with isolated throwaway data, beta editor enabled, no preview-render queue, and the fictional demo seed. The canonical `scripts/demo-seed.mjs` generator supplies its six fictional replays directly. Those captured replay `performance.entries` are synthetic **fixture content**, never used as measured browser performance. Comparison is explicitly unavailable on revisions without the comparison UI; a fallback index page is never accepted as comparison.

Before timing, a real replay is drawn and its first frame encoded into a 480px JPEG at quality 70, then placed in isolated poster/open storage for each fixture. Serving these files exercises the real poster endpoint, compression negotiation, ETags and cache headers. This measures serving already-rendered media, not poster generation CPU or image fidelity. All fixture IDs share this still so generation cannot contaminate samples. Server measurements use fresh TCP loopback connections, identity/gzip/br bodies and conditional ETag requests. Body bytes exclude HTTP headers; browser transfer bytes use CDP and include wire overhead. No external network is needed by the demo.

LCP is the last observed main-frame candidate before scripted input. CLS uses maximum 5-second session windows separated by 1-second gaps, excluding shifts following input. Lab INP uses the p98 of interaction IDs observed through Event Timing (16ms threshold), from search, settings navigation, and replay play/pause. A short scripted run is not field INP. No ≥16ms event means **unavailable**, not zero. TBT integrates task time beyond 50ms from FCP through page readiness plus 1.5 seconds; long-task count covers the complete visit including playback. First replay frame is navigation-to-two-rAFs after rrweb's recorded body exists, a presentation approximation. CDP ScriptDuration measures JS CPU; precise coverage records executed source code units, not download bytes. Memory is `JSHeapUsedSize` after two seconds of playback/pause without forced GC, not total resident memory. Playback pages must actually render a recorded body and perform play/pause.

The first sample of each scenario records a Chrome CPU profile and a Playwright trace (without screenshots/DOM snapshots). CDP response timings and resource timing entries retain the network waterfall in the raw JSON. All runs use the same trace/coverage schedule, including main, to keep instrumentation overhead symmetric. Raw JSON retains individual samples, response headers and conditional statuses. Trace artifact uploads are best effort when GitHub storage is full; the table reaches the summary/comment through a separate job output. Use the CPU profile when investigating a blocking-time regression; do not compare a heavy profiling run against an uninstrumented baseline.

CI runs on demand: add the `perf` label to a PR, or start the Runtime performance workflow manually (also how to collect main runs for calibration). It builds and measures current `origin/main` and the candidate independently using each lockfile on one runner. It uses the same harness/config for both. It publishes the full budget/median/delta table to the job summary, artifact and an updated bot PR comment for same-repository PRs. Fork PRs have read-only tokens and get the summary/artifact. No `pull_request_target`, credentials, or production data are involved. A failed main measurement is labeled unavailable and must be investigated; it cannot silently become a zero baseline.

## Ratchet to enforcement

1. Collect at least ten green main runs on the fixed `ubicloud-standard-2` runner. Inspect per-sample spread and unavailable metrics; validate all supported scenarios.
2. Replace provisional limits with measured main medians plus a documented noise allowance (initially max(20%, 100 ms) for timing; 10% for bytes, requests and heap; CLS remains 0.1). Capture the evidence/run links in the budget PR.
3. Fix consistent overruns, then change `mode` from `report-only` to `enforce`. Enforcement fails measured numeric overruns and missing required metrics/scenarios; allow unavailable INP only until enough scripted Event Timing observations exist.
4. Require the runtime check in branch protection after a week without noise failures. Ratchet limits downward with each measured win; increases need a reviewed product reason and before/after evidence.
5. For a regression, reproduce with ≥5 samples on identical hardware, inspect traces and only then adjust code or limits. Keep the fixed deterministic seed when adding a separate large-replay stress case.

Lighthouse CI is intentionally omitted. Its navigation score would duplicate LCP/CLS/TTFB under a different throttling model while missing scripted rrweb playback, editor/comparison interactions, executed coverage, heap, and authenticated media/API contracts. Add it later only for a distinct signal (for example an accessibility/SEO audit), not a second performance score to chase.

## SSR comparison and default-flip gate

The same harness accepts string-valued server overrides in `PERF_SERVER_ENV`, including `REPLAYS_SSR` and `BASE_PATH`. Browser and API URLs include that base automatically. It records only the SSR flag/base path in artifacts, rather than arbitrary environment values. `PERF_INDEX_ROWS` expands the fictional seed deterministically; the SSR gate defaults to 100 summaries and takes 20 server samples per encoding for nearest-rank p50/p90.

Run SPA and SSR on the same source, hardware and dataset (inside your own Boat command):

```sh
PERF_SSR_GATE=1 PERF_REVISION=<source-sha> PERF_OUTPUT=.review-artifacts/perf/spa PERF_SERVER_ENV='{"BASE_PATH":"/replays","REPLAYS_SSR":"0"}' node scripts/perf/run.mjs
PERF_SSR_GATE=1 PERF_REVISION=<same-source-sha> PERF_OUTPUT=.review-artifacts/perf/ssr PERF_SERVER_ENV='{"BASE_PATH":"/replays","REPLAYS_SSR":"1"}' node scripts/perf/run.mjs
node scripts/perf/report.mjs .review-artifacts/perf/ssr/results.json .review-artifacts/perf/spa/results.json .review-artifacts/perf/ssr-gate.md
```

The `ssrGate` section in `budgets/runtime.mjs` is report-only until the architect's default-flip review: phone index LCP ≤1200ms, first visible replay title ≤1000ms, viewer skeleton FCP ≤1000ms, viewer content no slower than SPA on either profile, `/` TTFB p50 ≤30ms/p90 ≤60ms with100summaries, Brotli index HTML ≤15000bytes, and zero hydration errors or browser refetches of the index list. The title metric observes the first nonempty feed title across two animation frames; viewer content readiness uses the recorded first replay frame. Hydration errors include matching console diagnostics and page exceptions; refetches count browser list requests, including preloads. The initial server-rendered list should require none.

A missing/mismatched SPA baseline never passes a relative gate. Keep SPA/SSR code revision, profile throttling and seed count identical. `ssrGate.mode = 'enforce'` makes the report command fail these gates when preparing the default flip; the ordinary runtime job remains report-only. Six-row default results and100-row SSR-gate results are separate datasets.

## Comparison tile sweep

On your own Boat checkout containing the comparison route, use:

```sh
PERF_COMPARE_TILES=2,4,6,9 PERF_PAGES=comparison-2,comparison-4,comparison-6,comparison-9 PERF_PLAYBACK_MS=5000 PERF_SAMPLES=3 node scripts/perf/run.mjs
node scripts/perf/report.mjs
```

The harness expands the deterministic demo seed to nine IDs and measures `/r/<id>?with=...&layout=grid` for each requested count. Add `PERF_PROFILES=phone` or `desktop` to focus a run. The shared Play button should be named `Play all recordings`/`Pause all recordings` (existing pair labels also work). The report includes rAF-gap p95 during playback, renderer `TaskDuration` divided by elapsed playback time, long tasks during playback, requested tile count and JS heap after pause. These are main-thread scheduling measurements, not compositor/GPU FPS. Existing off-screen pause, gallery and thumbnail policies remain active; a request for nine tiles does not imply nine are visible and playing simultaneously.

Initial report-only playback limits are desktop p95≤50ms/busy≤40%, phone p95≤100ms/busy≤70%, and both JS heap≤100MB. First-frame limits remain2500/5000ms. These are provisional targets to calibrate against the actual multi-player gallery and representative larger replay fixtures; the small demo cannot establish memory scalability. Cold-start and playback metrics are reported separately.

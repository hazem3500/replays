# Runtime performance budgets

`performance-budget.config.mjs` sits beside the bundle-size budget `.size-limit.json`. The runtime job is **report-only**: numeric overruns are warnings; build failures, harness errors, missing required pages, and incomplete samples fail the job. Bundle bytes are owned by the separate size-limit job.

Run on Boat (never oz-box):

```sh
oz-boat exec --session t3:<your-thread> -- bash -lc 'pnpm install --frozen-lockfile && pnpm exec playwright install chromium && pnpm build && node --test scripts/perf/model.test.mjs && node scripts/perf/run.mjs && node scripts/perf/report.mjs'
```

`PERF_SAMPLES=1` is useful for harness development, but cannot establish a baseline. Normal runs take three cold-context samples per page/profile, serially, and retain their median. `PERF_OUTPUT` selects the artifact directory. CDP disables HTTP cache and applies 4× CPU plus 150 ms latency / 1.6 Mbps down / 750 kbps up for the synthetic phone. Desktop uses the same Chrome without throttling. All samples record the runner CPU, visible core count, memory, Node and Chrome version; a 2-core/4-GB Boat result is not comparable to a different runner. The app forces list layout on phones: the grid scenario keeps a desktop viewport with the phone's CPU/network to exercise actual grid code.

The harness launches a production server with isolated throwaway data, beta editor enabled, no preview-render queue, and the fictional demo seed. Until the canonical demo generator ships, a frozen copy of its six fictional replay JSON files is used. Those captured replay `performance.entries` are synthetic **fixture content**, never used as measured browser performance. When available, `scripts/demo-seed.mjs` is invoked directly. Comparison is explicitly unavailable on revisions without the comparison UI; a fallback index page is never accepted as comparison.

Before timing, a real replay is drawn and its first frame encoded into a 480px JPEG at quality 70, then placed in isolated poster/open storage for each fixture. Serving these files exercises the real poster endpoint, compression negotiation, ETags and cache headers. This measures serving already-rendered media, not poster generation CPU or image fidelity. All fixture IDs share this still so generation cannot contaminate samples. Server measurements use fresh TCP loopback connections, identity/gzip/br bodies and conditional ETag requests. Body bytes exclude HTTP headers; browser transfer bytes use CDP and include wire overhead. No external network is needed by the demo.

LCP is the last observed main-frame candidate before scripted input. CLS uses maximum 5-second session windows separated by 1-second gaps, excluding shifts following input. Lab INP uses the p98 of interaction IDs observed through Event Timing (16ms threshold), from search, settings navigation, and replay play/pause. A short scripted run is not field INP. No ≥16ms event means **unavailable**, not zero. TBT integrates task time beyond 50ms from FCP through page readiness plus 1.5 seconds; long-task count covers the complete visit including playback. First replay frame is navigation-to-two-rAFs after rrweb's recorded body exists, a presentation approximation. CDP ScriptDuration measures JS CPU; precise coverage records executed source code units, not download bytes. Memory is `JSHeapUsedSize` after two seconds of playback/pause without forced GC, not total resident memory. Playback pages must actually render a recorded body and perform play/pause.

The first sample of each scenario records a Chrome CPU profile and a Playwright trace (without screenshots/DOM snapshots). CDP response timings and resource timing entries retain the network waterfall in the raw JSON. All runs use the same trace/coverage schedule, including main, to keep instrumentation overhead symmetric. Raw JSON retains individual samples, response headers and conditional statuses. Use the CPU profile when investigating a blocking-time regression; do not compare a heavy profiling run against an uninstrumented baseline.

CI builds and measures current `origin/main` and the candidate independently using each lockfile on one runner. It uses the same harness/config for both. It publishes the full budget/median/delta table to the job summary, artifact and an updated bot PR comment for same-repository PRs. Fork PRs have read-only tokens and get the summary/artifact. No `pull_request_target`, credentials, or production data are involved. A failed main measurement is labeled unavailable and must be investigated; it cannot silently become a zero baseline.

## Ratchet to enforcement

1. Collect at least ten green main runs on the fixed `ubicloud-standard-2` runner. Inspect per-sample spread and unavailable metrics; validate all supported scenarios.
2. Replace provisional limits with measured main medians plus a documented noise allowance (initially max(20%, 100 ms) for timing; 10% for bytes, requests and heap; CLS remains 0.1). Capture the evidence/run links in the budget PR.
3. Fix consistent overruns, then change `mode` from `report-only` to `enforce`. Enforcement fails measured numeric overruns and missing required metrics/scenarios; allow unavailable INP only until enough scripted Event Timing observations exist.
4. Require the runtime check in branch protection after a week without noise failures. Ratchet limits downward with each measured win; increases need a reviewed product reason and before/after evidence.
5. For a regression, reproduce with ≥5 samples on identical hardware, inspect traces and only then adjust code or limits. Keep the fixed deterministic seed when adding a separate large-replay stress case.

Lighthouse CI is intentionally omitted. Its navigation score would duplicate LCP/CLS/TTFB under a different throttling model while missing scripted rrweb playback, editor/comparison interactions, executed coverage, heap, and authenticated media/API contracts. Add it later only for a distinct signal (for example an accessibility/SEO audit), not a second performance score to chase.

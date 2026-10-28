# Mutation reports

Stryker 10.1.1 uses the existing Vitest runner against the critical contracts, sanitizers, persistence/migration, editor state and route parser listed in `stryker.config.mjs`. Storage's `assertKey` lives in `server/storage/types.ts`, so that module is included alongside the store. No application dependency or shipped bundle changes.

Run only on your own Boat or CI:

```sh
pnpm install --frozen-lockfile
pnpm build && pnpm build:cli
pnpm mutation
pnpm mutation:report
```

For a feature PR, narrow the run to the changed critical module, for example `pnpm mutation --mutate src/shared/profiles.ts`. Its dedicated test files are listed with the module in `stryker.config.mjs`; `--testFiles test/profiles.test.ts` can override them for a focused investigation. Revisit the route-parser target after the Router migration. The weekly/manual workflow measures all eleven modules separately. Incremental results, JSON, HTML and the Markdown summary live under `.review-artifacts/mutation/`; temporary sandboxes stay ignored. Two Stryker workers each run one Vitest worker.

Per-module runs retain static mutants, including privacy/limit constants. A single batch selected 1,402 transitively related tests, leaving each static mutant to rerun the whole application suite. Dedicated contract tests bound this cost and make the measured scope explicit. The manifest remains incomplete until every selected module finishes; the report refuses partial runs. Kill attribution is combined by test file, name and location across module reports, so a test killing a mutant in any run is not listed as zero-kill. Scores describe these selected suites, not the entire application suite.

This rollout is report-only: `thresholds.break` is zero; mutation scores do not fail CI. Invalid configuration, failed initial tests, missing/incomplete reports and runner errors still fail. Instrumentation adds startup cost, so the mutation-only Vitest config allows 15-second tests and 30-second hooks while preserving the ordinary unit configuration. Review a full stable measurement before adding a score ratchet.

The mutation profile excludes `test/dev-index-page.test.ts`: starting its nested Vite dev server against the instrumented application kills the worker with SIGKILL, reproduced directly in Stryker's sandbox. This dev-tool integration suite still runs in ordinary `pnpm check`; mutation targets and their related contract/storage/sanitizer tests are unchanged.

`mutation:report` prints module scores and every inventoried test absent from all mutants' `killedBy` arrays. Missing inventory, unknown test ids and killed mutants without attribution fail instead of presenting an empty clean report. **Zero attributed kills is a review candidate, never a deletion instruction.** Stryker normally stops at the first killing test; another useful test may cover the same mutant, cover another module outside this run, or detect a timeout. Review behavior and scope before deleting anything.

Upstream: [Vitest runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/), [configuration](https://stryker-mutator.io/docs/stryker-js/configuration/), [incremental mode](https://stryker-mutator.io/docs/stryker-js/incremental/), [report schema](https://github.com/stryker-mutator/mutation-testing-elements/blob/master/packages/report-schema/src/mutation-testing-report-schema.json).

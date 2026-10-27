# Lint guardrails

`pnpm lint` keeps the existing blocking policy. `.oxlintrc.next.json` and `.oxlintrc.types.next.json` add target rules separately, so legacy findings do not turn `--deny-warnings` red.

Run on the current session's Boat:

```sh
pnpm build:cli
pnpm lint:ratchet
pnpm lint:new-files --base origin/main
pnpm lint:ratchet:test
```

Build the package declarations first: the example consumer resolves published exports. Missing generated declarations produce misleading unsafe-type findings.

The ratchet compares counts per rule in three reports (syntax, type-aware, and syntax with unused disables) against `budgets/lint-baseline.json`. The full type-aware audit uses the file list resolved from `tsconfig.json`, excluding JavaScript scripts without project type information. Comments also have per-file allowances in `budgets/comment-baseline.json`; moving debt to another file fails. Missing entries allow zero findings. Crashes, invalid reports and parser/configuration errors fail. A decrease prints a request to lower the baseline. `node scripts/lint-ratchet.mjs --write-baseline` is an explicit measurement operation, never a CI step; review every baseline change.

Added JS/TS files run the syntax config with warnings denied; TypeScript files also run the type-aware config. JavaScript build scripts are outside the root TypeScript project. CI compares against the PR's merge base; the staged hook checks added index entries and requires their worktree contents to match the index. Existing files remain baselined. Suppressions need a specific `-- why:` reason; unused directives are counted separately rather than immediately failing legacy code.

Custom invariant rules will join the report configuration in a separate follow-up. The ratchet already supports per-file comment counts.

No global strict-boolean or React performance category is enabled. We keep `prefer-tag-over-role` off to avoid churn in intentional status/group containers. Public module boundary types are checked only on package API entries; internal return types remain inferred.

Initial native baseline measured on Boat from main `54e582e`: 2,123 syntax findings, 1,689 type-aware findings, and 2 unused disables. No legacy source fixes are included.

The base config promotes confirmed zero-debt rules for described TypeScript suppression comments, Node import protocols, nested component declarations and focused tests. Type-only imports, import ordering and duplicates remain reported because their counts are nonzero. The precise forwardRef check belongs to the custom plugin; a native import restriction conservatively rejects unrelated namespace imports.

Root TypeScript flags reject switch fallthrough, unreachable code and unused labels. `pnpm typecheck:overrides` additionally enables `noImplicitOverride` and allows only the two existing TS4114 findings in the actively owned comparison loading boundary. Its per-file baseline rejects every new file or count increase; other compiler errors fail. Remove the baseline and enable the root flag when the owner adds those modifiers. No reserved source is edited for this rollout.

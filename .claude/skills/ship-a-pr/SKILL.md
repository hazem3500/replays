---
name: ship-a-pr
description: Ship a scoped Replays PR with Boat validation and a review of project invariants.
---

Read AGENTS.md and docs/ownership.md; inspect the diff against freshly fetched origin/main. Keep active workstreams and unrelated files out. Use the installed GitButler skill when available; never run but setup in a linked worktree. If its linked-worktree operations are unsupported, use worktree-local Git without touching the shared checkout.

Commit, push, open a PR or merge only within the user's authorization. Run frozen install and full pnpm check on the session's own Boat, plus affected recorder/Storybook/e2e and report scripts. Review the final diff: tagged comments; no new effects outside hooks; no manual memo; files ≤400 lines; composable views; tests kill a plausible mutant; no dependency/bundle drift or raised baselines hiding debt. Explain any existing unrelated failure.

PR text describes the final behavior and evidence. Credit Hazem only; no AI trailers. Link the PR to the current T3 thread when that tool is available. Check CI on the pushed SHA and resolve actionable review findings. Do not claim green without evidence. If merge is authorized, squash only after all required checks pass and recheck the expected head. Stop the session's Boat at handoff. Summarize URL, SHA, check and merge state.

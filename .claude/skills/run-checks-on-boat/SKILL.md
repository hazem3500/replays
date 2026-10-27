---
name: run-checks-on-boat
description: Run Replays checks, focused tests and builds on the current session’s own Boat box.
---

Read root AGENTS.md and package.json. Use the actual current T3 thread id as `t3:<id>`; never infer one from a checkout name or reuse another session. From this worktree:

```sh
oz-boat exec --session t3:<YOUR_THREAD_ID> -- pnpm install --frozen-lockfile
oz-boat exec --session t3:<YOUR_THREAD_ID> -- pnpm check
oz-boat exec --session t3:<YOUR_THREAD_ID> -- pnpm test -- test/lint-policy.test.ts
oz-boat exec --session t3:<YOUR_THREAD_ID> -- pnpm test:recorder
oz-boat exec --session t3:<YOUR_THREAD_ID> -- pnpm typecheck:storybook
oz-boat exec --session t3:<YOUR_THREAD_ID> -- pnpm build:storybook
oz-boat exec --session t3:<YOUR_THREAD_ID> -- pnpm test:e2e -- e2e/smoke.spec.ts
```

Use an existing test path appropriate to the change; the example e2e path must be checked before use. Inspect scripts for the currently available Storybook interaction runner. `check` does not imply recorder, Storybook or e2e coverage. Record exact commands, exit codes and report counts. At quota/queue holds, wait or report; never run repo commands on oz-box. End at handoff with `oz-boat stop --session t3:<YOUR_THREAD_ID>` and retain its receipt.

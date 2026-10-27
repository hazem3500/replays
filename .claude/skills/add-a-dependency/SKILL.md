---
name: add-a-dependency
description: Evaluate and add a Replays dependency only when it removes code without duplicating the stack.
---

Read AGENTS.md, package.json and the existing primitives. Require evidence that the dependency deletes more hand-written code than bytes it adds, is maintained (normally a release within six months), typed and ESM, and does not duplicate Base UI, TanStack or server-side Effect. Use current upstream primary sources for maintenance/API claims.

Coordinate package.json and pnpm-lock.yaml with the tooling owner. Install only on the session's own Boat; never hand-edit the lockfile. Keep runtime, browser and dev-only dependencies correctly separated. Measure bundle impact with the tooling lane's current budget scripts; do not invent a command or baseline. Review knip output for redundant dependencies. Update public docs if the consumer contract changes, run frozen install and relevant checks on Boat, and explain byte/code tradeoffs in the PR.

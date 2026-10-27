---
name: split-a-god-file
description: Split an owned oversized Replays file while preserving its public behavior and imports.
---

Read AGENTS.md and docs/ownership.md. Do not split a file another lane is actively redesigning. Scope one PR to one source file and its extracted modules.

Map public exports, imports and state lifetimes first. Extract pure logic, then named hooks, then presentational views. Preserve original exports through temporary re-exports when callers rely on them; keep each new file ≤400 lines. Avoid new cycles, manual memo, direct effects outside src/client/hooks/, prop bags and feature dependencies in presentational components.

Reuse behavior tests; add tests only for meaningful newly exposed boundaries. Do not add exports solely for tests. Run focused tests and full pnpm check on the session's own Boat. Inspect import-boundary and lint report changes using the installed scripts, lower the relevant baseline entries, and verify no implementation change was hidden in the move.

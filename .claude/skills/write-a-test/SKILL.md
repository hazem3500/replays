---
name: write-a-test
description: Choose and write useful Replays behavior tests instead of implementation-shaped tests.
---

Read AGENTS.md and the area's existing tests. Test through the public module contract; do not export private helpers for tests. Mock only process boundaries: network, clock, filesystem or browser APIs, never our own modules.

Logic/contracts belong in Vitest (test/ or recorder colocated tests), UI behavior in story play tests with storybook/test, user flows in e2e. Use one behavior per it with a sentence name. Prefer failure cases, boundary values, privacy, cleanup, cancellation and conflicts. No snapshot-only, trivial getter/constant, or type-shape tests.

Before adding a test, state the plausible mutant or regression it catches. Delete it if there is none. Verify the behavior fails under that defect when practical, then run the focused suite on the current session's own Boat. Do not add UI test infrastructure or rewrite active stories without coordinating ownership.

# Human draft review and save lifecycle

XState **5.33.3** owns one Keep dialog's coarse lifecycle: draft, reviewing, saving, saved or discarded. Source and scope revisions invalidate review; failure returns to review with an error and requires another human click. The playhead and sandbox broker keep their existing owners.

Cancelling, replacing a draft or unmounting aborts approval/save/history requests and drops late actor results. The manager checks the source revision after every approval/save await. An old consent result cannot submit a changed draft. No bridge exposes the approve event or a save tool; the existing server's content-bound consent and sandbox policy remain authoritative.

A browser abort cannot roll back a write already committed on the server. The manager performs a bounded readback and reconciles versions without replacing a newer working source. If readback fails, the next human retry refreshes history first, avoids duplicating an already committed version, and requires fresh review when the baseline changed.

Focused checks: `pnpm exec vitest run test/draft-approval.test.ts test/malleable-client.test.ts --maxWorkers=1`. They cover forbidden agent approval, stale revisions, failed-save retry, cancellation/disposal and late results, source changes during consent minting, and retry after a committed write whose history read failed. Existing `e2e/malleable.spec.ts` covers the full human Keep/history/revert and agent-requested Keep flows.

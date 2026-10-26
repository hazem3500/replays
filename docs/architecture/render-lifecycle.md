# Scoped render lifecycle

Effect **4.0.6** owns a render job's scratch directory and deadline as a scope. The Promise `RenderRunner`, plugin hooks and ObjectStorage contracts remain unchanged. Cancellation reaches the runner through its original task `AbortSignal`; the scope waits for that Promise to settle before deleting working files. It preserves the original Error at the Promise boundary.

Queue shutdown closes admission, aborts queued/running jobs and drains their resources. Admission that was waiting for a cache lookup cannot start after shutdown. State-deletion errors are reported after draining runners; server shutdown still closes HTTP, application SQL and development/tracing resources.

This does not make an uncooperative Promise interruptible, make object-store uploads transactional with cancellation, or create durable render jobs. Existing portable render state and recovery remain authoritative.

Focused checks: `pnpm exec vitest run test/render-scope.test.ts test/render-queue.test.ts test/render-hooks.test.ts --maxWorkers=1`. They cover success/failure cleanup, timeout, cancellation with a delayed runner, upload failure, shutdown during cache lookup and failed state deletion.

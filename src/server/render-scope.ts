import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Cause, Effect, Exit } from 'effect';

interface RenderScopeOptions {
  tempDir?: string | undefined;
  controller: AbortController;
  timeoutMs: number;
}

/**
 * Own the scratch directory and deadline as one Effect scope, retaining the Promise runner boundary.
 * Cancellation reaches the runner through its original controller. We await that Promise's settlement
 * before releasing its files: Effect interruption must not remove a directory a legacy runner still uses.
 */
export async function withRenderScope<T>(options: RenderScopeOptions, run: (directory: string) => Promise<T>): Promise<T> {
  options.controller.signal.throwIfAborted();
  const program = Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.try({ try: () => mkdtempSync(join(options.tempDir ?? tmpdir(), 'replays-render-')), catch: (error) => error }),
        (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
      );
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          setTimeout(
            () => options.controller.abort(new Error(`timed out after ${Math.round(options.timeoutMs / 1000)} s`)),
            options.timeoutMs,
          ),
        ),
        (timer) => Effect.sync(() => clearTimeout(timer)),
      );
      return yield* Effect.tryPromise({ try: () => run(directory), catch: (error) => error });
    }),
  );
  const result = await Effect.runPromiseExit(program);
  if (Exit.isSuccess(result)) return result.value;
  // Public RenderRunner callers keep their existing Error identity/message, rather than a FiberFailure wrapper.
  throw Cause.squash(result.cause);
}

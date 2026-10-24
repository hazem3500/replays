/**
 * The bits of a test runner the contract suites need: vitest, Jest, Mocha and `node:test` all fit. The test function gets
 * the runner's context when it passes one (vitest's and `node:test`'s have `skip`).
 */
export interface TestRunner {
  describe(name: string, body: () => void): unknown;
  it(name: string, test: (context?: { skip?: (reason?: string) => unknown }) => Promise<void>): unknown;
}

type Globals = { describe?: TestRunner['describe']; it?: TestRunner['it'] };

/** The runner passed in, else the global `describe` / `it` (vitest with `globals`, Jest, Mocha). */
export function runnerOf(runner: TestRunner | undefined, suite: string): TestRunner {
  if (runner) return runner;
  const globals = globalThis as Globals;
  if (typeof globals.describe === 'function' && typeof globals.it === 'function') return { describe: globals.describe, it: globals.it };
  throw new Error(`${suite} needs a test runner: pass { describe, it } (from vitest, node:test, …) as the last argument`);
}

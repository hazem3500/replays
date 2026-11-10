import { createInterface } from 'node:readline';

export type ManualStopReason = 'closed' | 'enter' | 'signal' | 'max-duration';

interface Emitter {
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
}

export interface ManualStopOptions {
  /** Resolves when the person closes the page or the window. */
  closed: Promise<void>;
  maxDurationMs: number;
  /** Read for one line (Enter), only when it is a terminal: a pipe is never waited on. */
  stdin?: (Emitter & { isTTY?: boolean; pause(): unknown }) | undefined;
  /** `process`: SIGINT and SIGTERM stop the recording and save it. */
  signals?: Emitter;
  /** A second signal while saving; the default exits with the usual 130. */
  abort?: () => void;
  onTick?: (elapsedMs: number) => void;
  now?: () => number;
}

export const MANUAL_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/**
 * Waits for the first way a manual recording can end. The returned `release` removes every listener; call it once the
 * recording is saved, because until then a second signal aborts instead of being ignored.
 */
export function waitForManualStop(options: ManualStopOptions): { reason: Promise<ManualStopReason>; release: () => void } {
  const now = options.now ?? Date.now;
  const started = now();
  const cleanups: Array<() => void> = [];
  const waits: Array<() => void> = [];
  let settle!: (reason: ManualStopReason) => void;
  const reason = new Promise<ManualStopReason>((resolve) => {
    settle = resolve;
  });
  let stopped = false;
  const stop = (why: ManualStopReason) => {
    stopped = true;
    waits.splice(0).forEach((cleanup) => cleanup());
    settle(why);
  };

  void options.closed.then(() => stop('closed'));

  const timer = setTimeout(() => stop('max-duration'), options.maxDurationMs);
  waits.push(() => clearTimeout(timer));
  if (options.onTick) {
    const tick = options.onTick;
    const ticker = setInterval(() => tick(now() - started), 1000);
    waits.push(() => clearInterval(ticker));
  }

  const stdin = options.stdin;
  if (stdin?.isTTY) {
    const lines = createInterface({ input: stdin as never });
    lines.once('line', () => stop('enter'));
    waits.push(() => {
      lines.close();
      stdin.pause();
    });
  }

  if (options.signals) {
    const signals = options.signals;
    const onSignal = () => {
      if (stopped) (options.abort ?? (() => process.exit(130)))();
      else stop('signal');
    };
    for (const name of MANUAL_SIGNALS) {
      signals.on(name, onSignal);
      cleanups.push(() => signals.off(name, onSignal));
    }
  }

  return { reason, release: () => [...waits.splice(0), ...cleanups.splice(0)].forEach((cleanup) => cleanup()) };
}

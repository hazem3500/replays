/** Admits at most `size` holders at a time; the rest wait in arrival order. */
function limiter(size: number): { acquire: () => Promise<void>; release: () => void } {
  let active = 0;
  const waiting: Array<() => void> = [];
  return {
    async acquire() {
      if (active < size) {
        active++;
        return;
      }
      await new Promise<void>((resolve) => waiting.push(resolve));
    },
    release() {
      const next = waiting.shift();
      if (next) next();
      else active--;
    },
  };
}

/** `Promise.all(items.map(work))` with at most `size` calls in flight; results keep the input order. */
export function mapLimited<T, R>(items: Iterable<T>, size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const gate = limiter(size);
  return Promise.all(
    Array.from(items, async (item) => {
      await gate.acquire();
      try {
        return await work(item);
      } finally {
        gate.release();
      }
    }),
  );
}

/** The promise's value, or undefined when it rejects: for reads where one broken item is skipped, never fatal. */
export async function orAbsent<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise;
  } catch {
    return;
  }
}

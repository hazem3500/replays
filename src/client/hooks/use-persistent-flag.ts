import { useState } from 'react';

import { readStorage, writeStorage } from '../storage.ts';

/** A boolean kept per browser under `key` ('1' / '0'); `fallback` until the person sets it. */
export function usePersistentFlag(key: string, fallback = false) {
  const [value, setValue] = useState(() => {
    const saved = readStorage(key);
    return saved === '1' ? true : saved === '0' ? false : fallback;
  });
  const set = (next: boolean) => {
    writeStorage(key, next ? '1' : '0');
    setValue(next);
  };
  return [value, set] as const;
}

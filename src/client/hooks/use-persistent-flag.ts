import { useState } from 'react';

import { readStorage, writeStorage } from '../storage.ts';

function readFlag(key: string, fallback: boolean) {
  const saved = readStorage(key);
  if (saved === '1') return true;
  if (saved === '0') return false;
  return fallback;
}

/** A boolean kept per browser under `key` ('1' / '0'); `fallback` until the person sets it. */
export function usePersistentFlag(key: string, fallback = false) {
  const [value, setValue] = useState(() => readFlag(key, fallback));
  const set = (next: boolean) => {
    writeStorage(key, next ? '1' : '0');
    setValue(next);
  };
  return [value, set] as const;
}

/** localStorage that never throws: storage can be blocked (privacy modes, embedded frames). */
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function removeStorage(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // why: blocked storage throws; there is nothing to remove then.
  }
}

export function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preference is kept for this page only.
  }
}

/** Removes sessionStorage keys a feature no longer uses; blocked storage holds none. */
export function forgetSessionKeys(keys: readonly string[]) {
  try {
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // why: blocked storage (privacy modes, embedded frames) never kept them either.
  }
}

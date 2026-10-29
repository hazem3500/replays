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

/** sessionStorage that never throws: this tab's state, gone when the tab closes. */
export function readSessionStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Writes `value`, or removes the key when `value` is empty; blocked storage keeps nothing. */
export function writeSessionStorage(key: string, value: string) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // why: blocked storage (privacy modes, embedded frames): the feature falls back to its default.
  }
}

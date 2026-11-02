/** localStorage that never throws: storage can be blocked (privacy modes, embedded frames). */
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preference is kept for this page only.
  }
}

/** sessionStorage that never throws: per-tab memories (they end with the tab and never reach another one). */
export function readSessionStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSessionStorage(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // why: blocked or full storage only costs this tab's memory of it.
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

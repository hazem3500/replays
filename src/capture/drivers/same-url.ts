/** True when `url`, resolved against the open page's address `current`, is that same address (a goto would only reload it). */
export function isSameUrl(current: string, url: string): boolean {
  try {
    return new URL(url, current).href === new URL(current).href;
  } catch {
    return false;
  }
}

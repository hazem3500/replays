/**
 * Moves the keyboard into a filter surface once React has painted the next pane. Called from the event that
 * changes the pane (not an effect), so focus follows the person's action and nothing else.
 */
export function focusSoon(root: string, selectors: readonly string[]) {
  requestAnimationFrame(() => {
    const surface = document.querySelector<HTMLElement>(root);
    for (const selector of selectors) {
      const target = surface?.querySelector<HTMLElement>(selector);
      if (target) {
        target.focus();
        return;
      }
    }
  });
}

export const rowSelector = (key: string) => `[data-filter-key="${CSS.escape(key)}"]`;

/** Arrow keys, Home and End move focus through `items` (wrapping); returns whether the key was handled. */
export function moveFocusWithKeys(key: string, items: readonly HTMLElement[], current: Element | null) {
  const position = items.indexOf(current as HTMLElement);
  const next =
    key === 'ArrowDown'
      ? (position + 1) % items.length
      : key === 'ArrowUp'
        ? (position - 1 + items.length) % items.length
        : key === 'Home'
          ? 0
          : key === 'End'
            ? items.length - 1
            : undefined;
  if (next === undefined) return false;
  items[next]?.focus();
  return true;
}

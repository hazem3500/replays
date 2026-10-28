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
  const position = items.findIndex((item) => item === current);
  const count = items.length;
  const targets: Record<string, number> = {
    ArrowDown: (position + 1) % count,
    ArrowUp: (position - 1 + count) % count,
    Home: 0,
    End: count - 1,
  };
  const next = targets[key];
  if (next === undefined) return false;
  items[next]?.focus();
  return true;
}

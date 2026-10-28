/** Search ordinary DOM and open shadow roots. */
export function queryDeep<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  const found = root.querySelector<T>(selector);
  if (found) return found;
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot) {
      const child = queryDeep<T>(selector, element.shadowRoot);
      if (child) return child;
    }
  }
  return null;
}

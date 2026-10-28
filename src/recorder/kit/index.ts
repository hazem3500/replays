export { blockProps, recorderUiProps, blockSelector, CHAT_WIDGET_PRESETS, BLOCK_ATTRIBUTE, UI_ATTRIBUTE } from '../privacy.ts';

export function markRecorderUi<T extends HTMLElement>(element: T): T {
  element.setAttribute('data-recorder-ui', '');
  return element;
}
export function mountRecorderRoot(container: HTMLElement = document.body): { root: HTMLDivElement; remove(): void } {
  const root = markRecorderUi(document.createElement('div'));
  container.append(root);
  return { root, remove: (): void => root.remove() };
}
type Announcer = { say(text: string, politeness?: 'polite' | 'assertive'): void; dispose(): void };
export function createAnnouncer(options: { container?: () => HTMLElement } = {}): Announcer {
  let region: HTMLElement | undefined;
  let last = '';
  return {
    say(text: string, politeness: 'polite' | 'assertive' = 'polite'): void {
      if (last === text) return;
      last = text;
      if (!region) {
        region = markRecorderUi(document.createElement('div'));
        region.setAttribute('role', 'status');
        region.setAttribute('aria-atomic', 'true');
        region.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);';
        (options.container?.() ?? document.body).append(region);
      }
      region.setAttribute('aria-live', politeness);
      region.textContent = text;
    },
    dispose(): void {
      region?.remove();
      region = undefined;
      last = '';
    },
  };
}
export function focusReturn(fallback?: () => HTMLElement | null): { restore: () => void } {
  let previous = document.activeElement;
  while (previous?.shadowRoot?.activeElement) previous = previous.shadowRoot.activeElement;
  return {
    restore(): void {
      const target = previous?.isConnected ? previous : fallback?.();
      if (target instanceof HTMLElement) target.focus();
    },
  };
}
/** Trap Tab and inert the background, including ancestors across shadow boundaries. */
export function trapFocus(root: HTMLElement): () => void {
  const restored: { node: HTMLElement; inert: boolean }[] = [];
  let child: Node = root;
  let parent: Node | null = child.parentNode;
  while (parent) {
    for (const sibling of parent.childNodes)
      if (sibling !== child && sibling instanceof HTMLElement && !sibling.contains(root)) {
        restored.push({ node: sibling, inert: sibling.inert });
        sibling.inert = true;
      }
    child = parent;
    parent = parent instanceof ShadowRoot ? parent.host : parent.parentNode;
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const controls = [...root.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, [tabindex]')].filter(
      (node) => !node.hidden && !node.closest('[hidden], [inert]') && !node.hasAttribute('disabled') && node.tabIndex >= 0,
    );
    const scope = root.getRootNode();
    const active = scope instanceof ShadowRoot ? scope.activeElement : document.activeElement;
    const index = active instanceof HTMLElement ? controls.indexOf(active) : -1;
    const next = controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length];
    event.preventDefault();
    (next ?? root).focus();
  };
  root.addEventListener('keydown', onKey);
  return () => {
    root.removeEventListener('keydown', onKey);
    for (const item of restored) item.node.inert = item.inert;
  };
}

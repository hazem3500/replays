import { animate } from 'motion/mini';

export type PanelAxis = 'rows' | 'columns';
const pending = new WeakMap<HTMLElement, () => void>();

/** Stops a panel transition before a direct pointer resize takes over. */
export function cancelPanelMotion(target: HTMLElement) {
  pending.get(target)?.();
}

/** Captures the current grid, then animates to its next committed layout without changing pointer resize behavior. */
export function animatePanelLayout(target: HTMLElement, axis: PanelAxis) {
  const property = axis === 'rows' ? 'grid-template-rows' : 'grid-template-columns';
  const from = getComputedStyle(target).getPropertyValue(property);
  cancelPanelMotion(target);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let restore: string | undefined;
  let motion: ReturnType<typeof animate> | undefined;
  let frame = 0;
  const cleanup = () => {
    cancelAnimationFrame(frame);
    motion?.stop();
    if (restore !== undefined) {
      if (restore) target.style.setProperty(property, restore);
      else target.style.removeProperty(property);
    }
    target.removeAttribute('data-panel-sizing');
    if (pending.get(target) === cleanup) pending.delete(target);
  };
  pending.set(target, cleanup);
  frame = requestAnimationFrame(() => {
    const to = getComputedStyle(target).getPropertyValue(property);
    restore = target.style.getPropertyValue(property);
    if (!target.isConnected || from === to) {
      cleanup();
      return;
    }
    if (axis === 'rows' && target.dataset.mobile !== undefined) target.setAttribute('data-panel-sizing', '');
    motion = animate([target], axis === 'rows' ? { gridTemplateRows: [from, to] } : { gridTemplateColumns: [from, to] }, {
      duration: 0.22,
      ease: [0.22, 1, 0.36, 1],
    });
    void motion.then(() => {
      if (pending.get(target) === cleanup) cleanup();
    });
  });
}

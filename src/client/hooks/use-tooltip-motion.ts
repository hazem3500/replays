import { animate } from 'motion/mini';
import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';

function tooltipLabels(
  root: HTMLElement,
  instant: boolean,
  seen: WeakMap<Element, string>,
  running: Map<Element, ReturnType<typeof animate>>,
) {
  const layers = root.querySelectorAll<HTMLElement>('.tip-morph-viewport > *');
  for (const layer of layers) {
    const outgoing = layer.hasAttribute('data-previous');
    const phase = outgoing ? 'previous' : 'current';
    if (seen.get(layer) === phase && !instant) continue;
    const opacity = Number(getComputedStyle(layer).opacity || 1);
    running.get(layer)?.stop();
    seen.set(layer, phase);
    if (instant || typeof layer.animate !== 'function') {
      const target = outgoing ? '0' : '1';
      if (layer.style.opacity !== target) layer.style.setProperty('opacity', target);
      running.delete(layer);
      continue;
    }
    const from = outgoing ? opacity : Number(layers.length <= 1);
    running.set(
      layer,
      animate(
        [layer],
        { opacity: [from, outgoing ? 0 : 1] },
        { duration: outgoing ? 0.08 : 0.12, delay: outgoing ? 0 : 0.03, ease: [0.23, 1, 0.32, 1] },
      ),
    );
  }
}

interface GeometryOptions {
  keys: readonly string[];
  previous: Map<string, string>;
  instant: boolean;
  /** A change may glide only while the tooltip is switching triggers; otherwise it is placed. */
  hopping: boolean;
  running: Map<Element, ReturnType<typeof animate>>;
  cssVariables?: boolean;
}

function geometryFrames(node: HTMLElement, { keys, previous, running, cssVariables = false }: GeometryOptions) {
  const style = getComputedStyle(node);
  const frames: Record<string, string[]> = {};
  const targets = new Map<string, string>();
  for (const key of keys) {
    const target = cssVariables ? style.getPropertyValue(`--popup-${key}`).trim() : node.style.getPropertyValue(key);
    if (!target || target === 'auto') continue;
    targets.set(key, target);
    if (previous.get(key) === target) continue;
    const controls = running.get(node);
    const moving = controls?.state === 'running' || controls?.state === 'paused';
    const before = moving ? style.getPropertyValue(key) : previous.get(key);
    if (before !== undefined) frames[key] = [before, target];
    previous.set(key, target);
  }
  return { frames, targets };
}

function tooltipGeometry(node: HTMLElement, options: GeometryOptions) {
  const { instant, hopping, running } = options;
  const { frames, targets } = geometryFrames(node, options);
  const moved = Object.keys(frames).length > 0;
  if (!moved && !instant) return;
  running.get(node)?.stop();
  running.delete(node);
  // invariant: stopping Motion commits its current values; restore Base UI's targets before observing more writes.
  for (const [key, target] of targets) if (node.style.getPropertyValue(key) !== target) node.style.setProperty(key, target);
  if (instant || !hopping || typeof node.animate !== 'function' || !moved) return;
  running.set(node, animate([node], frames, { duration: 0.18, ease: [0.23, 1, 0.32, 1] }));
}

/** Neighbouring tooltip geometry and retained labels share a cancellable Motion timeline; keyboard hops remain immediate. */
export function useTooltipMotion(forwardedRef: Ref<HTMLDivElement> | undefined) {
  const element = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwardedRef, () => {
    if (!element.current) throw new Error('Tooltip ref was read before mounting');
    return element.current;
  }, []);
  useLayoutEffect(() => {
    const root = element.current;
    if (!root) return;
    const positions = new Map<string, string>();
    const dimensions = new Map<string, string>();
    const labels = new WeakMap<Element, string>();
    const running = new Map<Element, ReturnType<typeof animate>>();
    const update = () => {
      const popup = root.querySelector<HTMLElement>('.tip-morph-popup');
      const instant =
        root.hasAttribute('data-tip-jump') ||
        root.hasAttribute('data-instant') ||
        Boolean(popup?.hasAttribute('data-instant')) ||
        !root.hasAttribute('data-open') ||
        matchMedia('(prefers-reduced-motion: reduce)').matches;
      // invariant: an opening tooltip is placed, never flown in. Base UI writes a provisional corner position before it
      // measures the trigger, at a time that depends on the machine; only a switch between triggers shows an outgoing
      // label, so only that switch may glide.
      const hopping = Boolean(root.querySelector('.tip-morph-viewport > [data-previous]'));
      const geometry = { instant, hopping, running };
      tooltipGeometry(root, { keys: ['top', 'left', 'right', 'bottom'], previous: positions, ...geometry });
      if (popup) tooltipGeometry(popup, { keys: ['width', 'height'], previous: dimensions, ...geometry, cssVariables: true });
      tooltipLabels(root, instant, labels, running);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'data-open', 'data-instant', 'data-tip-jump', 'data-previous', 'data-current'],
    });
    return () => {
      observer.disconnect();
      for (const animation of running.values()) animation.stop();
    };
  }, []);
  return element;
}

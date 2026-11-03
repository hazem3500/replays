import { animate } from 'motion/mini';
import { useLayoutEffect, type RefObject } from 'react';

const TARGETS =
  '.scrubber-bars, .error-notch, .scrubber-bubble, .scrubber-knob-visual, .scrubber-segment-hover, .scrubber-highlight-band, .scrubber-highlight-glyph';
type Pose = Record<string, string | number>;

function scrubberState(root: HTMLElement, fine: boolean) {
  const keyboard = root.matches(':has(input:focus-visible)');
  const dragging = root.hasAttribute('data-scrubbing');
  const hover = fine && root.matches(':hover');
  return { dragging, active: keyboard || dragging || hover };
}

function errorPose(root: HTMLElement, active: boolean): Pose {
  const tab = root.closest('.app-shell')?.getAttribute('data-tab');
  return { opacity: active || tab === 'console' || tab === 'network' ? 1 : 0 };
}

function bubblePose(node: HTMLElement): Pose {
  const shown = node.dataset.visible === 'true';
  return { opacity: shown ? 1 : 0, transform: shown ? 'none' : 'translateY(2px) scale(0.98)' };
}

function knobPose(root: HTMLElement, state: ReturnType<typeof scrubberState>): Pose {
  const shown = state.active || root.hasAttribute('data-seeking');
  let scale = shown ? 1 : 0.4;
  if (state.dragging) scale = 1.1;
  return { opacity: shown ? 1 : 0, transform: `scale(${scale})` };
}

function highlightPose(node: HTMLElement, root: HTMLElement, fine: boolean): Pose {
  const highlight = node.closest('.scrubber-highlight');
  const active =
    Boolean(highlight?.querySelector('[data-selected="true"], :focus-visible')) || Boolean(fine && highlight?.matches(':hover'));
  if (node.matches('.scrubber-highlight-glyph')) return { scale: active ? 1.3 : 1 };
  const center = Number.parseFloat(getComputedStyle(root).getPropertyValue('--center')) || 14;
  return { top: `${center - (active ? 7 : 2)}px`, height: active ? '14px' : '4px' };
}

function pose(node: HTMLElement, root: HTMLElement, fine: boolean): Pose {
  const state = scrubberState(root, fine);
  if (node.matches('.scrubber-bars')) return { transform: state.active ? 'scaleY(1)' : 'scaleY(0.6667)' };
  if (node.matches('.error-notch')) return errorPose(root, state.active);
  if (node.matches('.scrubber-bubble')) return bubblePose(node);
  if (node.matches('.scrubber-knob-visual')) return knobPose(root, state);
  if (node.matches('.scrubber-segment-hover')) return { opacity: node.parentElement?.hasAttribute('data-hover') ? 1 : 0 };
  return highlightPose(node, root, fine);
}

function render(node: HTMLElement, target: Pose) {
  for (const [property, value] of Object.entries(target)) node.style.setProperty(property, String(value));
}

/** Animates only scrubber decorations; seeking, annotations, pointer tracking and replay progress keep their geometry. */
export function useScrubberPresenceMotion(scope: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const root = scope.current;
    if (!root) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const pointer = matchMedia('(hover: hover) and (pointer: fine)');
    const states = new Map<HTMLElement, string>();
    const running = new Map<HTMLElement, ReturnType<typeof animate>>();
    let live = true;
    const update = (instant = false) => {
      if (!live) return;
      for (const node of states.keys()) {
        if (root.contains(node)) continue;
        running.get(node)?.cancel();
        running.delete(node);
        states.delete(node);
      }
      for (const node of root.querySelectorAll<HTMLElement>(TARGETS)) {
        const target = pose(node, root, pointer.matches);
        const identity = JSON.stringify(target);
        if (states.get(node) === identity && !instant) continue;
        const first = !states.has(node);
        states.set(node, identity);
        running.get(node)?.stop();
        running.delete(node);
        if (first || instant || reduced.matches || node.hasAttribute('data-instant') || typeof node.animate !== 'function')
          render(node, target);
        else running.set(node, animate([node], target, { duration: 0.16, ease: [0.23, 1, 0.32, 1] }));
      }
    };
    const refresh = () => update();
    const reset = () => update(true);
    const focusOut = () => queueMicrotask(refresh);
    const observer = new MutationObserver(refresh);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-visible', 'data-instant', 'data-scrubbing', 'data-seeking', 'data-hover', 'data-selected'],
    });
    const shell = new MutationObserver(refresh);
    const app = root.closest('.app-shell');
    if (app) shell.observe(app, { attributes: true, attributeFilter: ['data-tab'] });
    for (const event of ['pointerover', 'pointerout', 'focusin']) root.addEventListener(event, refresh);
    root.addEventListener('focusout', focusOut);
    reduced.addEventListener('change', reset);
    pointer.addEventListener('change', reset);
    update(true);
    return () => {
      live = false;
      observer.disconnect();
      shell.disconnect();
      for (const event of ['pointerover', 'pointerout', 'focusin']) root.removeEventListener(event, refresh);
      root.removeEventListener('focusout', focusOut);
      reduced.removeEventListener('change', reset);
      pointer.removeEventListener('change', reset);
      for (const controls of running.values()) controls.cancel();
      for (const node of states.keys())
        for (const property of Object.keys(pose(node, root, pointer.matches))) node.style.removeProperty(property);
    };
  }, [scope]);
}

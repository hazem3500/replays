import { animate } from 'motion/mini';
import { useLayoutEffect, type RefObject } from 'react';

import { emphasis, PRESENCE_SELECTORS as SELECTORS, type Emphasis, type PresenceKind } from './viewer-presence-targets.ts';

interface AnimationState {
  states: Map<HTMLElement, string>;
  running: Map<HTMLElement, ReturnType<typeof animate>>;
  reduced: MediaQueryList;
  kind: PresenceKind;
}

function emphasisPose(target: Emphasis, kind: PresenceKind, reduced: boolean) {
  const pose: { opacity: number; transform?: string; translate?: string; scale?: number } = { opacity: target.opacity };
  if (kind === 'plugin') pose.transform = `translateY(${target.opacity ? 0 : 4}px)`;
  else if (target.x !== undefined) pose.transform = `translateX(${target.x}px)`;
  if (reduced && pose.transform) pose.transform = 'none';
  if (target.y !== undefined) pose.translate = `0 ${reduced ? 0 : target.y}px`;
  if (target.scale !== undefined) pose.scale = reduced ? 1 : target.scale;
  return pose;
}

function enteringTrack(node: HTMLElement, target: Emphasis, kind: PresenceKind, initial: boolean) {
  return initial && kind === 'track' && node.matches('.back-to-now') && Boolean(target.opacity) && !target.instant;
}

function renderEmphasis(node: HTMLElement, pose: ReturnType<typeof emphasisPose>, visibility: boolean) {
  for (const [property, value] of Object.entries(pose)) node.style.setProperty(property, String(value));
  if (visibility) node.style.setProperty('visibility', pose.opacity ? 'visible' : 'hidden');
}

function instantEmphasis(node: HTMLElement, target: Emphasis, state: AnimationState, initial: boolean) {
  return initial || state.reduced.matches || Boolean(target.instant) || typeof node.animate !== 'function';
}

function applyEmphasis(node: HTMLElement, target: Emphasis, state: AnimationState, initial: boolean) {
  const { states, running, reduced, kind } = state;
  const identity = JSON.stringify(target);
  if (!initial && states.get(node) === identity) return;
  states.set(node, identity);
  running.get(node)?.stop();
  running.delete(node);
  const visibility = kind === 'plugin' || target.hidden !== undefined;
  if (visibility && target.opacity) node.style.setProperty('visibility', 'visible');
  const entrance = enteringTrack(node, target, kind, initial);
  if (entrance) node.style.setProperty('opacity', '0');
  const instant = instantEmphasis(node, target, state, initial && !entrance);
  const pose = emphasisPose(target, kind, reduced.matches);
  if (instant) {
    renderEmphasis(node, pose, visibility);
    return;
  }
  const controls = animate([node], pose, { duration: target.duration ?? 0.12, delay: target.delay ?? 0, ease: [0.22, 1, 0.36, 1] });
  running.set(node, controls);
  void controls.then(() => {
    if (running.get(node) !== controls) return;
    running.delete(node);
    if (visibility && !target.opacity) node.style.setProperty('visibility', 'hidden');
  });
}

const ATTRIBUTES = [
  'class',
  'data-edge',
  'data-grip',
  'data-dragging',
  'data-playing',
  'data-fits',
  'data-now-end',
  'data-now-near',
  'data-popup-open',
  'data-resolved',
  'data-future',
];

function hoverScope(root: HTMLElement, kind: PresenceKind) {
  if (kind === 'track') return root.closest('.inspector') ?? root;
  if (kind === 'compare') return root.closest('.ct-tile') ?? root;
  return root;
}

/** UI presence only; recorded positions, seeking and drag geometry remain owned by their replay components. */
export function useViewerPresenceMotion(scope: RefObject<HTMLElement | null>, kind: PresenceKind, enabled = true) {
  useLayoutEffect(() => {
    const root = scope.current;
    if (!root || !enabled) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const pointer = matchMedia('(hover: hover) and (pointer: fine)');
    let live = true;
    const states = new Map<HTMLElement, string>();
    const running = new Map<HTMLElement, ReturnType<typeof animate>>();
    const animationState = { states, running, reduced, kind };
    const refresh = (initial = false) => {
      if (!live) return;
      for (const node of states.keys()) {
        if (root.contains(node)) continue;
        running.get(node)?.stop();
        running.delete(node);
        states.delete(node);
      }
      const nodes = root.matches(SELECTORS[kind]) ? [root] : root.querySelectorAll<HTMLElement>(SELECTORS[kind]);
      for (const node of nodes)
        applyEmphasis(node, emphasis(node, root, kind, pointer.matches), animationState, initial || !states.has(node));
    };
    const update = () => refresh();
    const reset = () => refresh(true);
    const onFocusOut = () => queueMicrotask(update);
    const hoverRoot = hoverScope(root, kind);
    const observer = new MutationObserver(update);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ATTRIBUTES });
    const parentObserver = new MutationObserver(update);
    const app = kind === 'chrome' ? root.closest('.app-shell') : null;
    if (app) parentObserver.observe(app, { attributes: true, attributeFilter: ['data-chrome', 'data-playing'] });
    hoverRoot.addEventListener('pointerover', update);
    hoverRoot.addEventListener('pointerout', update);
    root.addEventListener('pointerdown', update);
    root.addEventListener('pointerup', update);
    root.addEventListener('pointercancel', update);
    root.addEventListener('focusin', update);
    root.addEventListener('focusout', onFocusOut);
    reduced.addEventListener('change', reset);
    pointer.addEventListener('change', reset);
    refresh(true);
    return () => {
      live = false;
      observer.disconnect();
      parentObserver.disconnect();
      hoverRoot.removeEventListener('pointerover', update);
      hoverRoot.removeEventListener('pointerout', update);
      root.removeEventListener('pointerdown', update);
      root.removeEventListener('pointerup', update);
      root.removeEventListener('pointercancel', update);
      root.removeEventListener('focusin', update);
      root.removeEventListener('focusout', onFocusOut);
      reduced.removeEventListener('change', reset);
      pointer.removeEventListener('change', reset);
      for (const controls of running.values()) controls.stop();
      for (const node of states.keys()) {
        node.style.removeProperty('opacity');
        node.style.removeProperty('transform');
        node.style.removeProperty('scale');
        node.style.removeProperty('translate');
        node.style.removeProperty('visibility');
      }
      running.clear();
      states.clear();
    };
  }, [scope, kind, enabled]);
}

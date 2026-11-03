export type PresenceKind = 'steps' | 'track' | 'info' | 'plugin' | 'comments' | 'context' | 'compare' | 'rows' | 'network' | 'chrome';
export type Emphasis = {
  opacity: number;
  x?: number;
  y?: number;
  hidden?: boolean;
  scale?: number;
  duration?: number;
  delay?: number;
  instant?: boolean;
};

const focused = (node: Element) => node.matches(':focus-within');

function stepEmphasis(node: HTMLElement, _scope: HTMLElement, fine: boolean): Emphasis {
  if (node.matches('.step-edge-hint')) return { opacity: node.hasAttribute('data-edge') ? 1 : 0, duration: 0.12 };
  const row = node.closest('.step');
  const active = Boolean(row?.classList.contains('active'));
  const keyboard = Boolean(row?.matches(':focus-visible'));
  const instant = active || keyboard;
  const visible = instant || (fine && Boolean(row?.matches(':hover')));
  return { opacity: visible ? 1 : 0, x: visible ? 0 : 4, duration: visible ? 0.14 : 0.12, delay: visible && !instant ? 0.25 : 0, instant };
}

function dividerState(scope: HTMLElement) {
  const line = scope.querySelector('.now-divider');
  const keyboard = Boolean(line?.querySelector(':focus-visible'));
  const dragging = Boolean(line?.hasAttribute('data-dragging'));
  const shown = line?.getAttribute('data-grip') === 'shown';
  return { keyboard, dragging, shown, direct: keyboard || dragging || shown || scope.matches(':active') };
}

function trackLine(scope: HTMLElement, direct: boolean, fine: boolean): Emphasis {
  const atEnd = scope.hasAttribute('data-now-end');
  const near = scope.hasAttribute('data-now-near');
  const hover = fine && Boolean(scope.closest('.inspector')?.matches(':hover'));
  let opacity = 0.35;
  if (atEnd && !focused(scope)) opacity = 0;
  if (direct || near || (!atEnd && hover)) opacity = 1;
  return {
    opacity: scope.hasAttribute('data-fits') ? 0 : opacity,
    duration: opacity === 1 ? 0.4 : 0.3,
    delay: opacity === 1 && !direct ? 0.08 : 0,
    instant: direct || focused(scope),
  };
}

function trackEmphasis(node: HTMLElement, scope: HTMLElement, fine: boolean): Emphasis {
  const { keyboard, dragging, shown, direct } = dividerState(scope);
  if (node.matches('.now-grip')) {
    const visible = shown || dragging || keyboard;
    return { opacity: visible ? 1 : 0, scale: visible ? 1 : 0.96, duration: shown ? 0.2 : 0.15, instant: keyboard || dragging };
  }
  if (node.matches('.back-to-now')) {
    const visible = scope.hasAttribute('data-playing') || scope.matches(':hover') || focused(scope);
    return { opacity: visible ? 1 : 0, duration: 0.15, instant: focused(scope) };
  }
  return trackLine(scope, direct, fine);
}

function commentParent(node: HTMLElement, card: boolean) {
  if (card) return node.closest('.comment-marker');
  return node.closest(node.matches('.comment-actions') ? '.comment' : '.comment-reaction-chip');
}

function markerEmphasis(node: HTMLElement, fine: boolean): Emphasis {
  return { opacity: node.hasAttribute('data-resolved') ? 0.55 : 1, scale: fine && node.matches(':hover') ? 1.12 : 1 };
}

function commentEmphasis(node: HTMLElement, _scope: HTMLElement, fine: boolean): Emphasis {
  if (node.matches('.comment-marker-button')) return markerEmphasis(node, fine);
  const card = node.matches('.comment-card');
  const parent = commentParent(node, card);
  const keyboard = Boolean(parent?.matches(card ? ':has(:focus-visible)' : ':focus-within'));
  const visible = (!card && !fine) || keyboard || Boolean(parent?.matches(':hover')) || Boolean(node.querySelector('[data-popup-open]'));
  const target: Emphasis = { opacity: visible ? 1 : 0, duration: 0.12, instant: keyboard };
  if (card) Object.assign(target, { y: visible ? 0 : 4, hidden: !visible });
  return target;
}

function hoverGroup(node: HTMLElement, selector: string, fine: boolean): Emphasis {
  const parent = node.closest(selector);
  return {
    opacity: !fine || Boolean(parent?.matches(':hover, :focus-within')) ? 1 : 0,
    instant: Boolean(parent?.matches(':focus-within')),
  };
}

function chromeEmphasis(node: HTMLElement): Emphasis {
  const app = node.closest('.app-shell');
  const quiet = app?.getAttribute('data-chrome') === 'quiet' && app.hasAttribute('data-playing');
  return { opacity: quiet && !node.matches(':hover, :focus-within') ? 0.12 : 1, duration: 0.24, instant: focused(node) };
}

function pluginEmphasis(node: HTMLElement): Emphasis {
  const marker = node.closest('.plugin-track-marker');
  const keyboard = Boolean(marker?.querySelector(':focus-visible'));
  const visible = keyboard || Boolean(marker?.matches(':hover'));
  return { opacity: visible ? 1 : 0, x: 0, duration: 0.12, instant: keyboard };
}

type Target = (node: HTMLElement, scope: HTMLElement, fine: boolean) => Emphasis;
const TARGETS: Record<PresenceKind, Target> = {
  rows: (node) => ({ opacity: node.closest('[data-future]') ? 0.5 : 1 }),
  network: (node, _scope, fine) => hoverGroup(node, '.np-section', fine),
  chrome: chromeEmphasis,
  comments: commentEmphasis,
  context: (node, _scope, fine) => hoverGroup(node, '.ctx-row', fine),
  compare: (node, _scope, fine) => hoverGroup(node, '.ct-tile', fine),
  steps: stepEmphasis,
  track: trackEmphasis,
  info: (_node, scope, fine) => ({
    opacity: !fine || scope.matches(':hover') || focused(scope) ? 1 : 0,
    duration: 0.12,
    instant: focused(scope),
  }),
  plugin: pluginEmphasis,
};

export function emphasis(node: HTMLElement, scope: HTMLElement, kind: PresenceKind, fine: boolean) {
  return TARGETS[kind](node, scope, fine);
}

export const PRESENCE_SELECTORS: Record<PresenceKind, string> = {
  steps: '.step small, .step-edge-hint',
  track: '.now-line, .now-grip, .back-to-now',
  info: '.info-action',
  plugin: '.plugin-track-card',
  comments: '.comment-marker-button, .comment-card, .comment-actions, .comment-reaction-remove',
  context: '.ctx-actions',
  compare: '.ct-actions',
  rows: '.np-bar, .pp-bar',
  network: '.np-copy',
  chrome: '.app-topbar',
};

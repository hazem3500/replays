export type ShortcutAction =
  | 'play-pause'
  | 'seek-back'
  | 'seek-forward'
  | 'seek-back-long'
  | 'seek-forward-long'
  | 'previous-step'
  | 'next-step'
  | 'next-error'
  | 'previous-error'
  | 'speed-up'
  | 'speed-down'
  | 'speed-reset'
  | 'console-tab'
  | 'network-tab'
  | 'performance-tab'
  | 'fullscreen'
  | 'switch-inspector'
  | 'switch-captions'
  | 'next-run'
  | 'previous-run'
  | 'shortcuts';

export interface KeyLike {
  key: string;
  /** Physical key, for Shift+0 (which types ")" only on some layouts). */
  code?: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export interface TargetLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']);

/** True while the user is typing, when shortcuts must stay out of the way. */
export function isTypingTarget(target: TargetLike | null | undefined) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  return tag === 'input' && !NON_TEXT_INPUTS.has((target.type ?? 'text').toLowerCase());
}

/** Space/Enter on a button with the keyboard cursor activate that button, not a shortcut. */
function activatesTarget(event: KeyLike, target: TargetLike | null | undefined) {
  const tag = target?.tagName?.toLowerCase();
  return (event.key === ' ' || event.key === 'Enter') && (tag === 'button' || tag === 'a' || tag === 'summary');
}

export function shortcutFor(event: KeyLike, target?: TargetLike | null): ShortcutAction | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  if (isTypingTarget(target) || activatesTarget(event, target)) return undefined;
  if (event.shiftKey && event.code === 'Digit0') return 'speed-reset';
  switch (event.key) {
    case ' ':
    case 'k':
    case 'K':
      return event.shiftKey && event.key !== ' ' ? undefined : 'play-pause';
    case 'ArrowLeft':
      return event.shiftKey ? 'seek-back-long' : 'seek-back';
    case 'ArrowRight':
      return event.shiftKey ? 'seek-forward-long' : 'seek-forward';
    case '[':
      return 'previous-step';
    case ']':
      return 'next-step';
    case 'e':
      return 'next-error';
    case 'E':
      return event.shiftKey ? 'previous-error' : 'next-error';
    // Matched on the produced character, so any layout that types < and > works.
    case '>':
      return 'speed-up';
    case '<':
      return 'speed-down';
    case ')':
      return event.shiftKey ? 'speed-reset' : undefined;
    case 'c':
      return 'console-tab';
    case 'C':
      return event.shiftKey ? 'switch-captions' : 'console-tab';
    case 'n':
    case 'N':
      return 'network-tab';
    case 'p':
    case 'P':
      return 'performance-tab';
    case 'f':
    case 'F':
      return 'fullscreen';
    // Suite workspace only. K already plays/pauses, so the previous run is Shift+J.
    case 'j':
      return 'next-run';
    case 'J':
      return event.shiftKey ? 'previous-run' : 'next-run';
    case '\\':
      return 'switch-inspector';
    case '?':
      return 'shortcuts';
    default:
      return undefined;
  }
}

export const SHORTCUT_GROUPS: Array<{ title: string; items: Array<{ keys: string[]; label: string }> }> = [
  {
    title: 'Playback',
    items: [
      { keys: ['Space', 'K'], label: 'Play or pause' },
      { keys: ['←', '→'], label: 'Seek 1 second' },
      { keys: ['Shift ←', 'Shift →'], label: 'Seek 5 seconds' },
      { keys: ['<', '>'], label: 'Speed down / up' },
      { keys: ['Shift 0'], label: 'Reset speed' },
      { keys: ['F'], label: 'Fullscreen' },
    ],
  },
  {
    title: 'Navigate',
    items: [
      { keys: ['['], label: 'Previous step' },
      { keys: [']'], label: 'Next step' },
      { keys: ['E'], label: 'Next error' },
      { keys: ['Shift E'], label: 'Previous error' },
      { keys: ['J'], label: 'Next run (review suite)' },
      { keys: ['Shift J'], label: 'Previous run (review suite)' },
    ],
  },
  {
    title: 'Inspect',
    items: [
      { keys: ['C'], label: 'Console tab' },
      { keys: ['N'], label: 'Network tab' },
      { keys: ['P'], label: 'Performance tab' },
      { keys: ['↑', '↓'], label: 'Previous / next request (on a Network row)' },
      { keys: ['Esc'], label: 'Close the open request' },
      { keys: ['\\'], label: 'Collapse or expand the panel' },
      { keys: ['Shift C'], label: 'Step captions on the player' },
      { keys: ['?'], label: 'Show shortcuts' },
    ],
  },
];

/** The key cap(s) shown for an action in tooltips: one source of truth with the switch above. */
const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  'play-pause': 'Space',
  'seek-back': '←',
  'seek-forward': '→',
  'seek-back-long': 'Shift ←',
  'seek-forward-long': 'Shift →',
  'previous-step': '[',
  'next-step': ']',
  'next-error': 'E',
  'previous-error': 'Shift E',
  'speed-up': '>',
  'speed-down': '<',
  'speed-reset': 'Shift 0',
  'console-tab': 'C',
  'network-tab': 'N',
  'performance-tab': 'P',
  fullscreen: 'F',
  'switch-inspector': '\\',
  'switch-captions': 'Shift C',
  'next-run': 'J',
  'previous-run': 'Shift J',
  shortcuts: '?',
};

export function shortcutLabel(action: ShortcutAction) {
  return SHORTCUT_LABELS[action];
}

/** macOS / iOS: ⌘ instead of Ctrl in key caps. */
export function isMacPlatform() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** The replay index's command search: ⌘K (Ctrl K elsewhere), and "/" (IndexHeader.tsx handles both). */
export function indexSearchShortcut() {
  return isMacPlatform() ? '⌘K' : 'Ctrl K';
}
export const INDEX_SEARCH_ALT_KEY = '/';

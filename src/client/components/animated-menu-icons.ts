import type { AnimatedIconDefinition } from './animated-icon-data.ts';

/** One-shot gestures retain the familiar lucide geometry and return to rest before the next menu action. */
export const MENU_ICONS = {
  plus: {
    ms: 240,
    motion: { kind: 'shift', rotate: 90, scale: 0.92 },
    parts: [
      { el: 'path', attrs: { d: 'M12 5v14' } },
      { el: 'path', attrs: { d: 'M5 12h14' } },
    ],
  },
  'columns-2': {
    ms: 260,
    parts: [
      { el: 'rect', attrs: { x: '3', y: '3', width: '18', height: '18', rx: '2' } },
      { el: 'path', attrs: { d: 'M12 3v18' }, motion: { kind: 'shift', x: 2 } },
    ],
  },
  'trash-2': {
    ms: 280,
    parts: [
      { el: 'path', attrs: { d: 'M3 6h18' }, motion: { kind: 'shift', y: -1.5, rotate: -6 } },
      { el: 'path', attrs: { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' } },
      { el: 'path', attrs: { d: 'M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2' }, motion: { kind: 'shift', y: -1.5, rotate: -6 } },
      { el: 'path', attrs: { d: 'M10 11v6' } },
      { el: 'path', attrs: { d: 'M14 11v6' } },
    ],
  },
  puzzle: {
    ms: 280,
    motion: { kind: 'shift', rotate: -6, scale: 0.94 },
    parts: [
      {
        el: 'path',
        attrs: {
          d: 'M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.684 1.683a2.414 2.414 0 0 1 0 3.414l-1.503 1.503a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.015 3.014 1 1 0 0 1 .474 1.68l-1.683 1.684a2.414 2.414 0 0 1-3.414 0l-1.684-1.684a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.014 1 1 0 0 0 .474-1.68l-1.684-1.684a2.414 2.414 0 0 1 0-3.414l1.684-1.684a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.014 1 1 0 0 1-.474-1.68l1.684-1.684a2.414 2.414 0 0 1 3.414 0z',
        },
      },
    ],
  },
} satisfies Record<string, AnimatedIconDefinition>;

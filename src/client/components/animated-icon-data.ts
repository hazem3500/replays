import { MENU_ICONS } from './animated-menu-icons.ts';

/**
 * Geometry + one-shot gestures for the animated icons (see animated-icon.tsx).
 *
 * Geometry is copied from lucide-react 1.55 (ISC, © Lucide Contributors) so an animated icon is pixel-identical
 * to the lucide icon it replaces when at rest. Gestures are Motion ports of lucide-animated
 * (https://github.com/pqoqubbw/icons, MIT, © 2024-2026 pqoqubbw) where that library has the icon, cut from its
 * 0.45–1.3 s springs to 220–380 ms ease-out; the rest (mouse-pointer-2, text-cursor-input, globe, arrow-down-up,
 * info, ellipsis, list, pause) are drawn here in the same style. Motion's mini animate drives the moving SVG parts.
 */

/** How a part moves while the icon plays. Every gesture returns to the lucide pose. */
export interface PartMotion {
  /**
   * shift: out to the offset and back (a nudge). from: settles in from the offset (an entrance).
   * spin: rotates to `rotate` (only for shapes that look the same there, e.g. 180° hourglass, 360° arrow).
   * draw: strokes the path in (needs pathLength 1, set automatically).
   */
  kind: 'shift' | 'from' | 'spin' | 'draw';
  x?: number;
  y?: number;
  /** Uniform scale; `sx` / `sy` override per axis. */
  scale?: number;
  sx?: number;
  sy?: number;
  /** Degrees. */
  rotate?: number;
  opacity?: number;
  /** ms after the icon starts; the part still ends with the icon. */
  delay?: number;
  /** transform-origin inside the part's own box (fill-box), e.g. 'left', 'center bottom'. */
  origin?: string;
}

export type PartElement = 'path' | 'circle' | 'rect';

export interface IconPart {
  el: PartElement;
  attrs: Record<string, string>;
  motion?: PartMotion;
}

export interface AnimatedIconDefinition {
  /** Total play time in ms. */
  ms: number;
  /** Moves the whole glyph (wrapped in a <g>), on top of any per-part motion. */
  motion?: PartMotion;
  parts: IconPart[];
}

const path = (d: string, motion?: PartMotion): IconPart => (motion ? { el: 'path', attrs: { d }, motion } : { el: 'path', attrs: { d } });

const SUN_RAYS = [
  'M12 2v2',
  'm19.07 4.93-1.41 1.41',
  'M20 12h2',
  'm17.66 17.66 1.41 1.41',
  'M12 20v2',
  'm6.34 17.66-1.41 1.41',
  'M2 12h2',
  'm4.93 4.93 1.41 1.41',
];

const ICONS = {
  ...MENU_ICONS,
  pencil: {
    ms: 260,
    motion: { kind: 'shift', x: 1, y: -1 },
    parts: [
      path(
        'M21.174 6.812a1 1 0 0 0-3.986-3.986L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.623l4.353-1.32a2 2 0 0 0 .83-.5z',
      ),
      path('m15 5 4 4'),
    ],
  },
  // Step kinds -------------------------------------------------------------------------------------------
  'mouse-pointer-click': {
    ms: 300,
    parts: [
      path('M14 4.1 12 6', { kind: 'from', scale: 0.2, opacity: 0, delay: 90 }),
      path('m5.1 8-2.9-.8', { kind: 'from', scale: 0.2, opacity: 0, delay: 90 }),
      path('m6 12-1.9 2', { kind: 'from', scale: 0.2, opacity: 0, delay: 90 }),
      path('M7.2 2.2 8 5.1', { kind: 'from', scale: 0.2, opacity: 0, delay: 90 }),
      path(
        'M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z',
        { kind: 'shift', x: -1.5, y: -1.5 },
      ),
    ],
  },
  'mouse-pointer-2': {
    ms: 260,
    motion: { kind: 'shift', x: 1.5, y: 1.5 },
    parts: [
      path(
        'M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z',
      ),
    ],
  },
  'text-cursor-input': {
    ms: 320,
    parts: [
      path('M12 20h-1a2 2 0 0 1-2-2 2 2 0 0 1-2 2H6', { kind: 'shift', opacity: 0.15 }),
      path('M13 8h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-7'),
      path('M5 16H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h1'),
      path('M6 4h1a2 2 0 0 1 2 2 2 2 0 0 1 2-2h1', { kind: 'shift', opacity: 0.15 }),
      path('M9 6v12', { kind: 'shift', opacity: 0.15 }),
    ],
  },
  keyboard: {
    ms: 320,
    parts: [
      path('M10 8h.01', { kind: 'shift', opacity: 0.15, delay: 25 }),
      path('M12 12h.01', { kind: 'shift', opacity: 0.15, delay: 65 }),
      path('M14 8h.01', { kind: 'shift', opacity: 0.15, delay: 50 }),
      path('M16 12h.01', { kind: 'shift', opacity: 0.15, delay: 90 }),
      path('M18 8h.01', { kind: 'shift', opacity: 0.15, delay: 75 }),
      path('M6 8h.01', { kind: 'shift', opacity: 0.15 }),
      path('M7 16h10', { kind: 'shift', y: 1, delay: 110 }),
      path('M8 12h.01', { kind: 'shift', opacity: 0.15, delay: 40 }),
      { el: 'rect', attrs: { width: '20', height: '16', x: '2', y: '4', rx: '2' } },
    ],
  },
  'corner-down-left': {
    ms: 260,
    parts: [path('M20 4v7a4 4 0 0 1-4 4H4', { kind: 'shift', sx: 1.12, origin: 'right' }), path('m9 10-5 5 5 5', { kind: 'shift', x: -2 })],
  },
  globe: {
    ms: 340,
    parts: [
      { el: 'circle', attrs: { cx: '12', cy: '12', r: '10' } },
      path('M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', { kind: 'shift', sx: 0.15 }),
      path('M2 12h20'),
    ],
  },
  'arrow-down-up': {
    ms: 280,
    parts: [
      path('m3 16 4 4 4-4', { kind: 'shift', y: 2 }),
      path('M7 20V4', { kind: 'shift', y: 2 }),
      path('m21 8-4-4-4 4', { kind: 'shift', y: -2, delay: 40 }),
      path('M17 4v16', { kind: 'shift', y: -2, delay: 40 }),
    ],
  },
  hourglass: {
    ms: 380,
    motion: { kind: 'spin', rotate: 180 },
    parts: [
      path('M5 22h14'),
      path('M5 2h14'),
      path('M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22'),
      path('M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2'),
    ],
  },

  // Top bar ----------------------------------------------------------------------------------------------
  info: {
    ms: 260,
    parts: [
      { el: 'circle', attrs: { cx: '12', cy: '12', r: '10' } },
      path('M12 16v-4', { kind: 'from', sy: 0, origin: 'center bottom' }),
      path('M12 8h.01', { kind: 'from', y: -3, opacity: 0, delay: 60 }),
    ],
  },
  download: {
    ms: 260,
    parts: [
      path('M12 15V3', { kind: 'shift', y: 2.5 }),
      path('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'),
      path('m7 10 5 5 5-5', { kind: 'shift', y: 2.5 }),
    ],
  },
  upload: {
    ms: 260,
    parts: [
      path('M12 3v12', { kind: 'shift', y: -2.5 }),
      path('m17 8-5-5-5 5', { kind: 'shift', y: -2.5 }),
      path('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'),
    ],
  },
  link: {
    ms: 280,
    parts: [
      path('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', { kind: 'shift', x: 1.25, y: -1.25 }),
      path('M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71', { kind: 'shift', x: -1.25, y: 1.25 }),
    ],
  },
  copy: {
    ms: 300,
    parts: [
      { el: 'rect', attrs: { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' }, motion: { kind: 'shift', x: -2, y: -2 } },
      path('M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2', { kind: 'shift', x: 2, y: 2 }),
    ],
  },
  check: {
    ms: 240,
    parts: [path('M20 6 9 17l-5-5', { kind: 'draw' })],
  },
  sun: {
    ms: 300,
    parts: [
      { el: 'circle', attrs: { cx: '12', cy: '12', r: '4' }, motion: { kind: 'from', scale: 0.7 } },
      ...SUN_RAYS.map((d, index) => path(d, { kind: 'from', scale: 0.2, opacity: 0, delay: index * 20 })),
    ],
  },
  moon: {
    ms: 300,
    motion: { kind: 'shift', rotate: -20 },
    parts: [path('M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401')],
  },
  // External links (↗): the arrow nudges up-right and back.
  'arrow-up-right': {
    ms: 240,
    motion: { kind: 'shift', x: 1.5, y: -1.5 },
    parts: [path('M7 7h10v10'), path('M7 17 17 7')],
  },
  // Player controls: fullscreen corners open out (maximize) or tuck in (minimize); caption lines slide like text.
  maximize: {
    ms: 260,
    parts: [
      path('M8 3H5a2 2 0 0 0-2 2v3', { kind: 'shift', x: -1.5, y: -1.5 }),
      path('M21 8V5a2 2 0 0 0-2-2h-3', { kind: 'shift', x: 1.5, y: -1.5 }),
      path('M3 16v3a2 2 0 0 0 2 2h3', { kind: 'shift', x: -1.5, y: 1.5 }),
      path('M16 21h3a2 2 0 0 0 2-2v-3', { kind: 'shift', x: 1.5, y: 1.5 }),
    ],
  },
  minimize: {
    ms: 260,
    parts: [
      path('M8 3v3a2 2 0 0 1-2 2H3', { kind: 'shift', x: 1.5, y: 1.5 }),
      path('M21 8h-3a2 2 0 0 1-2-2V3', { kind: 'shift', x: -1.5, y: 1.5 }),
      path('M3 16h3a2 2 0 0 1 2 2v3', { kind: 'shift', x: 1.5, y: -1.5 }),
      path('M16 21v-3a2 2 0 0 1 2-2h3', { kind: 'shift', x: -1.5, y: -1.5 }),
    ],
  },
  captions: {
    ms: 280,
    parts: [
      { el: 'rect', attrs: { width: '18', height: '14', x: '3', y: '5', rx: '2', ry: '2' } },
      path('M7 15h4M15 15h2', { kind: 'shift', x: 1.5, delay: 40 }),
      path('M7 11h2M13 11h4', { kind: 'shift', x: 1.5 }),
    ],
  },
  'chevron-down': { ms: 220, parts: [path('m6 9 6 6 6-6', { kind: 'shift', y: 2 })] },
  'chevron-up': { ms: 220, parts: [path('m18 15-6-6-6 6', { kind: 'shift', y: -2 })] },
  'chevron-left': { ms: 220, parts: [path('m15 18-6-6 6-6', { kind: 'shift', x: -2 })] },
  'chevron-right': { ms: 220, parts: [path('m9 18 6-6-6-6', { kind: 'shift', x: 2 })] },
  ellipsis: {
    ms: 320,
    parts: [
      { el: 'circle', attrs: { cx: '12', cy: '12', r: '1' }, motion: { kind: 'shift', y: -2, delay: 40 } },
      { el: 'circle', attrs: { cx: '19', cy: '12', r: '1' }, motion: { kind: 'shift', y: -2, delay: 80 } },
      { el: 'circle', attrs: { cx: '5', cy: '12', r: '1' }, motion: { kind: 'shift', y: -2 } },
    ],
  },

  // Transport --------------------------------------------------------------------------------------------
  play: {
    ms: 220,
    motion: { kind: 'from', x: -1, scale: 0.8 },
    parts: [path('M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z')],
  },
  pause: {
    ms: 220,
    parts: [
      { el: 'rect', attrs: { x: '14', y: '3', width: '5', height: '18', rx: '1' }, motion: { kind: 'from', sy: 0.6, delay: 40 } },
      { el: 'rect', attrs: { x: '5', y: '3', width: '5', height: '18', rx: '1' }, motion: { kind: 'from', sy: 0.6 } },
    ],
  },
  'rotate-ccw': {
    ms: 380,
    motion: { kind: 'spin', rotate: -360 },
    parts: [path('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'), path('M3 3v5h5')],
  },

  // Index ------------------------------------------------------------------------------------------------
  search: {
    ms: 300,
    motion: { kind: 'shift', x: -1.5, y: -1.5, rotate: -8 },
    parts: [path('m21 21-4.34-4.34'), { el: 'circle', attrs: { cx: '11', cy: '11', r: '8' } }],
  },
  'sliders-horizontal': {
    ms: 360,
    parts: [
      // Each knob slides 3 units; the two halves of its rail stretch/shrink so they stay joined to it.
      path('M10 5H3', { kind: 'shift', sx: 4 / 7, origin: 'left' }),
      path('M12 19H3', { kind: 'shift', sx: 6 / 9, origin: 'left', delay: 60 }),
      path('M14 3v4', { kind: 'shift', x: -3 }),
      path('M16 17v4', { kind: 'shift', x: -3, delay: 60 }),
      path('M21 12h-9', { kind: 'shift', sx: 6 / 9, origin: 'right', delay: 30 }),
      path('M21 19h-5', { kind: 'shift', sx: 8 / 5, origin: 'right', delay: 60 }),
      path('M21 5h-7', { kind: 'shift', sx: 10 / 7, origin: 'right' }),
      path('M8 10v4', { kind: 'shift', x: 3, delay: 30 }),
      path('M8 12H3', { kind: 'shift', sx: 8 / 5, origin: 'left', delay: 30 }),
    ],
  },
  'layout-grid': {
    ms: 300,
    parts: [
      { el: 'rect', attrs: { width: '7', height: '7', x: '3', y: '3', rx: '1' }, motion: { kind: 'shift', scale: 0.75 } },
      { el: 'rect', attrs: { width: '7', height: '7', x: '14', y: '3', rx: '1' }, motion: { kind: 'shift', scale: 0.75, delay: 30 } },
      { el: 'rect', attrs: { width: '7', height: '7', x: '14', y: '14', rx: '1' }, motion: { kind: 'shift', scale: 0.75, delay: 90 } },
      { el: 'rect', attrs: { width: '7', height: '7', x: '3', y: '14', rx: '1' }, motion: { kind: 'shift', scale: 0.75, delay: 60 } },
    ],
  },
  list: {
    ms: 300,
    parts: [
      path('M3 5h.01', { kind: 'from', opacity: 0 }),
      path('M3 12h.01', { kind: 'from', opacity: 0, delay: 40 }),
      path('M3 19h.01', { kind: 'from', opacity: 0, delay: 80 }),
      path('M8 5h13', { kind: 'from', sx: 0.4, origin: 'left' }),
      path('M8 12h13', { kind: 'from', sx: 0.4, origin: 'left', delay: 40 }),
      path('M8 19h13', { kind: 'from', sx: 0.4, origin: 'left', delay: 80 }),
    ],
  },
  layers: {
    ms: 320,
    parts: [
      path('M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z', {
        kind: 'shift',
        y: -3,
      }),
      path('M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12', { kind: 'shift', y: -1.5, delay: 30 }),
      path('M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17'),
    ],
  },
} satisfies Record<string, AnimatedIconDefinition>;

export type AnimatedIconName = keyof typeof ICONS;

export const ANIMATED_ICONS: Readonly<Record<AnimatedIconName, AnimatedIconDefinition>> = ICONS;

export const ANIMATED_ICON_NAMES = Object.keys(ICONS) as AnimatedIconName[];

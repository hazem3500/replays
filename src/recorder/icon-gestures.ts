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

/**
 * Icon gestures shared by the viewer's AnimatedIcon and the browser recorder's default UI, so both draw and move the
 * same glyphs; pure data, with no DOM, React or client imports. Geometry is copied from lucide-react 1.55 (ISC,
 * © Lucide Contributors); gestures are ports of lucide-animated (https://github.com/pqoqubbw/icons, MIT,
 * © 2024-2026 pqoqubbw), cut to 220 to 380 ms ease-out.
 */
export const SHARED_ICON_GESTURES = {
  x: {
    ms: 240,
    motion: { kind: 'shift', rotate: 90, scale: 0.86 },
    parts: [path('M18 6 6 18'), path('m6 6 12 12')],
  },
  'sliders-horizontal': {
    ms: 360,
    parts: [
      // why: each knob slides 3 units; the two halves of its rail stretch or shrink so they stay joined to it.
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
} satisfies Record<string, AnimatedIconDefinition>;

/** The keyframes of one part's gesture, for Motion's `animate` or the Web Animations API. */
export function gestureFrames(motion: PartMotion) {
  const pose = `translate(${motion.x ?? 0}px, ${motion.y ?? 0}px) rotate(${motion.rotate ?? 0}deg) scale(${motion.sx ?? motion.scale ?? 1}, ${motion.sy ?? motion.scale ?? 1})`;
  const opacity = motion.opacity ?? 1;
  switch (motion.kind) {
    case 'shift':
      return { transform: ['none', pose, 'none'], opacity: [1, opacity, 1] };
    case 'from':
      return { transform: [pose, 'none'], opacity: [opacity, 1] };
    case 'spin':
      return { transform: ['rotate(0deg)', `rotate(${motion.rotate ?? 0}deg)`] };
    case 'draw':
      return { strokeDashoffset: [1, 0], opacity: [0, 1] };
  }
}

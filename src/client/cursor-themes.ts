import { CURSOR_COLORS, type CursorAppearance, type CursorColor } from '../shared/cursor.ts';
import { CURSOR_CANVAS, CURSOR_HOTSPOT, CURSOR_PATH } from './cursor-motion.ts';

/**
 * The cursors a replay can be drawn with. Each theme builds its glyph as inline-painted SVG, so the viewer, the editor
 * preview, the inspector's picker and the MP4 render page (which has none of the app's stylesheet) draw it the same.
 * Ported from the unshipped cursor-appearance increment: the built-in shapes only, without its plugin slot or the
 * dotLottie loader for CUA theme archives. CUA itself ships one theme, whose arrow is `arrow` here.
 *
 * A glyph is pure in the press age it is given (`feedback(press)`, ms since the press or -1), so seeking and export
 * frames are exact. The default arrow keeps the original press squish only; the ripple and pulse belong to the themes
 * that ask for them, and nothing is drawn outside a press.
 */
export type CursorFeedback = 'ripple' | 'pulse' | 'press';

export interface CursorGlyph {
  /** Appended to the cursor element in order. */
  nodes: Element[];
  width: number;
  height: number;
  /** The point that lands on the recorded position, in glyph px. */
  hotspot: { x: number; y: number };
  feedback(press: number): void;
}

export interface CursorTheme {
  id: CursorAppearance;
  label: string;
  description: string;
  feedback: CursorFeedback;
  create(doc: Document, color?: string): CursorGlyph;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Every glyph is drawn in a 32 px box, the original cursor's on-screen size. */
const BOX = 32;
const INK = '#111111';
const OUTLINE = '#ffffff';
const RIPPLE_MS = 450;
const PULSE_MS = 400;
const AGENT_LABEL = 'Agent';

const CLASSIC_ARROW = 'M9 5 L9 24.5 L13.6 20.4 L16.6 27.2 L19.9 25.8 L16.9 19.1 L23 19.1 Z';
const HAND =
  'M13.5 3.5 C12.1 3.5 11 4.6 11 6 L11 15.5 L9.6 14.3 C8.6 13.4 7.1 13.5 6.2 14.5 C5.4 15.4 5.4 16.8 6.2 17.7 L11.5 24.5 C13 26.5 15.3 28 18 28 L20 28 C23.9 28 27 24.9 27 21 L27 15.5 C27 14.3 26 13.3 24.8 13.3 C23.6 13.3 22.6 14.3 22.6 15.5 L22.6 14.6 C22.6 13.4 21.6 12.4 20.4 12.4 C19.2 12.4 18.2 13.4 18.2 14.6 L18.2 14 C18.2 12.8 17.2 11.8 16 11.8 L16 6 C16 4.6 14.9 3.5 13.5 3.5 Z';
const AGENT_ARROW = 'M6 5 L6 21.5 L10.6 17.2 L18.5 17.2 Z';

function svg(doc: Document, tag: string, attributes: Record<string, string | number> = {}): SVGElement {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

const paint = (fill: string, stroke: string, width: number) =>
  `fill:${fill};stroke:${stroke};stroke-width:${width};stroke-linejoin:round;stroke-linecap:round`;

function channel(hex: string, at: number) {
  const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);

/** WCAG contrast of two #rrggbb colours. */
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Text that reads on `background`: ink or white, whichever contrasts more. */
export const readableOn = (background: string) => (contrast(background, INK) >= contrast(background, OUTLINE) ? INK : OUTLINE);

export const cursorColorValue = (color: CursorColor | undefined) => (color ? CURSOR_COLORS[color] : undefined);

/** A click effect centred on the hotspot, in its own SVG: a ring that spreads (`ripple`) or a halo that swells (`pulse`). */
function clickEffect(doc: Document, kind: 'ripple' | 'pulse', { hotspot, color, radius }: Paint) {
  const [from, to] = radius;
  const box = to + 4;
  const node = svg(doc, 'svg', { viewBox: `${-box} ${-box} ${box * 2} ${box * 2}`, 'aria-hidden': 'true' });
  node.style.cssText = `position:absolute;left:${hotspot.x - box}px;top:${hotspot.y - box}px;width:${box * 2}px;height:${box * 2}px;overflow:visible;filter:none;pointer-events:none;display:none`;
  const circle = svg(doc, 'circle', { cx: 0, cy: 0, r: from });
  circle.style.cssText = kind === 'ripple' ? `fill:none;stroke:${color};stroke-width:2` : `fill:${color};stroke:none`;
  node.append(circle);
  const length = kind === 'ripple' ? RIPPLE_MS : PULSE_MS;
  const peak = kind === 'ripple' ? 0.55 : 0.35;
  return {
    node,
    draw: (press: number) => {
      const p = press < 0 || press >= length ? -1 : press / length;
      if (p < 0) {
        // invariant: hidden is one state whatever came before, so a seek lands on the same DOM from any direction.
        node.style.display = 'none';
        return;
      }
      const eased = 1 - (1 - p) ** 3;
      node.style.display = 'block';
      circle.setAttribute('r', (from + (to - from) * eased).toFixed(2));
      circle.style.opacity = (peak * (1 - p)).toFixed(3);
    },
  };
}

interface Paint {
  hotspot: { x: number; y: number };
  color: string;
  radius: [number, number];
}

interface GlyphParts {
  root: SVGElement;
  hotspot: { x: number; y: number };
  feedback: CursorFeedback;
  color: string;
  extra?: Element[];
  radius?: [number, number];
}

function glyph(doc: Document, { root, hotspot, feedback, color, extra = [], radius }: GlyphParts): CursorGlyph {
  if (feedback === 'press') return { nodes: [root, ...extra], width: BOX, height: BOX, hotspot, feedback() {} };
  const effect = clickEffect(doc, feedback, { hotspot, color, radius: radius ?? (feedback === 'ripple' ? [3, 16] : [5, 15]) });
  return { nodes: [effect.node, root, ...extra], width: BOX, height: BOX, hotspot, feedback: effect.draw };
}

const boxSvg = (doc: Document) => svg(doc, 'svg', { viewBox: `0 0 ${BOX} ${BOX}`, 'aria-hidden': 'true' });

const ARROW: CursorTheme = {
  id: 'arrow',
  label: 'CUA arrow',
  description: 'The CUA pointer with a soft press',
  feedback: 'press',
  create(doc, color) {
    const root = svg(doc, 'svg', { viewBox: `0 0 ${CURSOR_CANVAS} ${CURSOR_CANVAS}`, 'aria-hidden': 'true' });
    const path = svg(doc, 'path', { d: CURSOR_PATH, style: paint(color ?? INK, OUTLINE, 8) });
    root.append(path);
    const scale = BOX / CURSOR_CANVAS;
    return glyph(doc, {
      root,
      hotspot: { x: CURSOR_HOTSPOT.x * scale, y: CURSOR_HOTSPOT.y * scale },
      feedback: 'press',
      color: color ?? INK,
    });
  },
};

export const CURSOR_THEMES: readonly CursorTheme[] = [
  ARROW,
  {
    id: 'classic-arrow',
    label: 'Classic',
    description: 'A familiar desktop pointer with a click ripple',
    feedback: 'ripple',
    create(doc, color) {
      const root = boxSvg(doc);
      const path = svg(doc, 'path', { d: CLASSIC_ARROW, style: paint(color ?? INK, OUTLINE, 1.75) });
      root.append(path);
      return glyph(doc, { root, hotspot: { x: 9, y: 5 }, feedback: 'ripple', color: color ?? INK });
    },
  },
  {
    id: 'hand',
    label: 'Hand',
    description: 'The pointing hand of links, with a click ripple',
    feedback: 'ripple',
    create(doc, color) {
      const root = boxSvg(doc);
      const path = svg(doc, 'path', { d: HAND, style: paint(color ?? OUTLINE, color ? OUTLINE : INK, 1.5) });
      root.append(path);
      return glyph(doc, { root, hotspot: { x: 13.5, y: 3.5 }, feedback: 'ripple', color: color ?? INK });
    },
  },
  {
    id: 'dot',
    label: 'Dot',
    description: 'A small, quiet dot that pulses on clicks',
    feedback: 'pulse',
    create(doc, color) {
      const fill = color ?? CURSOR_COLORS.accent;
      const root = boxSvg(doc);
      const dot = svg(doc, 'circle', { cx: 16, cy: 16, r: 5.5, style: paint(fill, OUTLINE, 2) });
      root.append(dot);
      return glyph(doc, { root, hotspot: { x: 16, y: 16 }, feedback: 'pulse', color: fill });
    },
  },
  {
    id: 'ring',
    label: 'Ring',
    description: 'A halo around the point, for touch-style demos',
    feedback: 'pulse',
    create(doc, color) {
      const tint = color ?? CURSOR_COLORS.accent;
      const root = boxSvg(doc);
      const halo = svg(doc, 'circle', { cx: 16, cy: 16, r: 10, style: paint('none', OUTLINE, 4.5) });
      const ring = svg(doc, 'circle', { cx: 16, cy: 16, r: 10, style: paint(tint, tint, 2.25) });
      ring.style.setProperty('fill-opacity', '0.16');
      const centre = svg(doc, 'circle', { cx: 16, cy: 16, r: 1.75, style: paint(tint, 'none', 0) });
      root.append(halo, ring, centre);
      return glyph(doc, { root, hotspot: { x: 16, y: 16 }, feedback: 'pulse', color: tint, radius: [10, 20] });
    },
  },
  {
    id: 'agent',
    label: 'Agent',
    description: 'A pointer with a name tag, for agent runs',
    feedback: 'press',
    create(doc, color) {
      const fill = color ?? CURSOR_COLORS.accent;
      const root = boxSvg(doc);
      const path = svg(doc, 'path', { d: AGENT_ARROW, style: paint(fill, OUTLINE, 1.5) });
      root.append(path);
      const tag = doc.createElement('span');
      tag.className = 'replay-cursor-tag';
      tag.textContent = AGENT_LABEL;
      tag.style.cssText =
        `position:absolute;left:15px;top:19px;padding:1px 7px;border:1.5px solid ${OUTLINE};border-radius:999px;` +
        `background:${fill};color:${readableOn(fill)};font:600 11px/15px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;` +
        `white-space:nowrap;box-shadow:0 1px 2px rgb(0 0 0 / 0.25)`;
      return glyph(doc, { root, hotspot: { x: 6, y: 5 }, feedback: 'press', color: fill, extra: [tag] });
    },
  },
];

/** The theme for a saved appearance; the CUA arrow when it is absent. */
export function cursorTheme(appearance: CursorAppearance | undefined): CursorTheme {
  return CURSOR_THEMES.find((theme) => theme.id === appearance) ?? ARROW;
}

import { CURSOR_COLORS, DEFAULT_CURSOR_APPEARANCE, type CursorColor } from '../shared/cursor.ts';
import { cuaLottieTheme, type CuaLottieThemeDefinition } from './cua-cursor-theme.ts';
import { CURSOR_CANVAS, CURSOR_HOTSPOT, CURSOR_PATH } from './cursor-motion.ts';
import { resolveSlot } from './plugins/registry.ts';
import type { SlotDescriptor } from './plugins/slots.ts';

/**
 * Cursor themes: what draws the replay cursor. One registry for the viewer, the editor preview and the video
 * export (they all mount ReplayCursor), so a theme looks the same everywhere. Built-ins are `core:*` slot items;
 * plugins and deployments add `plugin:<owner>:<id>` items to the `cursor.themes` slot with
 * `api.registerSlotItem('cursor.themes', { id, order, render: () => definition })`, where `definition` is plain
 * data (`CursorShapesDefinition` or `CuaLottieThemeDefinition`). The built-in artwork is drawn here, for Replays;
 * no third-party cursor assets are bundled.
 *
 * A glyph is pure in its inputs: `feedback(press)` draws the click ripple, pulse or press for a press `press` ms
 * old (the pose's `press`, from replay time), so seeking and export frames are exact.
 */
export const CURSOR_THEMES_SLOT = 'cursor.themes';

export type CursorFeedback = 'ripple' | 'pulse' | 'press';

export interface CursorThemeContext {
  /** `player`: viewer, editor preview and export (ReplayCursor). `picker`: the inspector's previews. */
  surface: 'player' | 'picker';
}

export interface CursorGlyphOptions {
  document: Document;
  /** A resolved tint (CURSOR_COLORS value), or the theme's own colours. */
  color?: string | undefined;
  /** The agent tag's text. */
  label: string;
}

export interface CursorGlyph {
  /** Appended, in order, into the cursor box. */
  nodes: Element[];
  /** The box at 100 %, CSS px, and the hotspot inside it. */
  width: number;
  height: number;
  hotspot: { x: number; y: number };
  /** Draws click feedback `press` ms after a press, or none for -1. Pure in `press`. */
  feedback(press: number): void;
  /** Settles once the current frame is drawn (themes that draw asynchronously); export waits on it. */
  ready?(): Promise<void>;
  destroy?(): void;
}

export interface CursorTheme {
  id: string;
  label: string;
  description: string;
  feedback: CursorFeedback;
  /** Takes the colour swatches. */
  tintable: boolean;
  /** Loads a player when first drawn: the picker shows a placeholder rather than loading it for a preview. */
  lazy?: boolean;
  create(options: CursorGlyphOptions): CursorGlyph;
}

/** Plugin data for a vector theme: paths on a view box, set as attributes (never parsed as markup). */
export interface CursorShapesDefinition {
  kind: 'shapes';
  label: string;
  description?: string;
  feedback?: CursorFeedback;
  /** View box width and height. */
  viewBox: [number, number];
  /** On-screen size at 100 %, CSS px. */
  size: [number, number];
  /** Hotspot in view box units. */
  hotspot: [number, number];
  /** At most 16. `tint` takes the chosen colour for that paint. */
  shapes: Array<{ d: string; fill?: string; stroke?: string; strokeWidth?: number; tint?: 'fill' | 'stroke' }>;
}

export type CursorThemeDefinition = CursorShapesDefinition | CuaLottieThemeDefinition;

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Ripple and pulse lengths, ms; both end inside the press window (CLICK_FX_MS). */
const RIPPLE_MS = 450;
const PULSE_MS = 500;
const OUTLINE = '#ffffff';
const INK = '#111111';

const svg = (doc: Document, tag: string, attributes: Record<string, string | number> = {}) => {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
};

/** Inline paint: `.replay-cursor path` rules (styles.css, render.css) style the default arrow and would beat attributes. */
function paint(node: Element, fill: string, stroke: string, width: number) {
  (node as SVGElement).style.cssText = `fill:${fill};stroke:${stroke};stroke-width:${width};stroke-linejoin:round;stroke-linecap:round`;
}

/** sRGB relative luminance. */
function luminance(hex: string) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value.slice(0, 6);
  const channel = (i: number) => {
    const c = Number.parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export const contrastRatio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** White or ink text, whichever reads better on `background`. */
export const readableOn = (background: string) =>
  contrastRatio(background, '#ffffff') >= contrastRatio(background, '#181b22') ? '#ffffff' : '#181b22';

export const cursorColorValue = (color: CursorColor | undefined) => (color ? CURSOR_COLORS[color] : undefined);

/**
 * A click effect centred on the hotspot, in its own SVG so the cursor's own box stays as it was. `ripple`: a ring
 * that spreads and fades. `pulse`: a filled halo that swells and fades. Hidden outside a press.
 */
function clickEffect(doc: Document, kind: 'ripple' | 'pulse', hotspot: { x: number; y: number }, color: string, from: number, to: number) {
  const box = to + 4;
  const node = svg(doc, 'svg', { viewBox: `${-box} ${-box} ${box * 2} ${box * 2}`, 'aria-hidden': 'true' });
  (node as SVGElement).style.cssText =
    `position:absolute;left:${hotspot.x - box}px;top:${hotspot.y - box}px;width:${box * 2}px;height:${box * 2}px;overflow:visible;filter:none;pointer-events:none;display:none`;
  const circle = svg(doc, 'circle', { cx: 0, cy: 0, r: from });
  (circle as SVGElement).style.cssText = kind === 'ripple' ? `fill:none;stroke:${color};stroke-width:2` : `fill:${color};stroke:none`;
  node.append(circle);
  const length = kind === 'ripple' ? RIPPLE_MS : PULSE_MS;
  const peak = kind === 'ripple' ? 0.55 : 0.35;
  let last = '';
  return {
    node,
    draw(press: number) {
      const p = press < 0 || press >= length ? -1 : press / length;
      const key = p < 0 ? '' : p.toFixed(3);
      if (key === last) return;
      last = key;
      if (p < 0) {
        // invariant: hidden is one state whatever came before, so a seek lands on the same DOM from any direction.
        (node as SVGElement).style.display = 'none';
        circle.setAttribute('r', String(from));
        (circle as SVGElement).style.opacity = '';
        return;
      }
      const eased = 1 - (1 - p) ** 3;
      (node as SVGElement).style.display = 'block';
      circle.setAttribute('r', (from + (to - from) * eased).toFixed(2));
      (circle as SVGElement).style.opacity = (peak * (1 - p)).toFixed(3);
    },
  };
}

interface Drawn {
  root: Element;
  width: number;
  height: number;
  hotspot: { x: number; y: number };
}

/** A glyph from drawn SVG plus its theme's click feedback. */
function glyph(
  doc: Document,
  drawn: Drawn,
  feedback: CursorFeedback,
  effectColor: string,
  extra: Element[] = [],
  radius: [number, number] = feedback === 'ripple' ? [3, 16] : [5, 15],
): CursorGlyph {
  if (feedback === 'press') return { nodes: [drawn.root, ...extra], ...drawn, feedback() {} };
  const effect = clickEffect(doc, feedback, drawn.hotspot, effectColor, radius[0], radius[1]);
  return {
    nodes: [effect.node, drawn.root, ...extra],
    width: drawn.width,
    height: drawn.height,
    hotspot: drawn.hotspot,
    feedback: effect.draw,
  };
}

const BOX = 32;
/** Original artwork, drawn on a 32-unit box shown at 32 px. */
const CLASSIC_ARROW = 'M9 5 L9 24.5 L13.6 20.4 L16.6 27.2 L19.9 25.8 L16.9 19.1 L23 19.1 Z';
const HAND =
  'M13.5 3.5 C12.1 3.5 11 4.6 11 6 L11 15.5 L9.6 14.3 C8.6 13.4 7.1 13.5 6.2 14.5 C5.4 15.4 5.4 16.8 6.2 17.7 L11.5 24.5 C13 26.5 15.3 28 18 28 L20 28 C23.9 28 27 24.9 27 21 L27 15.5 C27 14.3 26 13.3 24.8 13.3 C23.6 13.3 22.6 14.3 22.6 15.5 L22.6 14.6 C22.6 13.4 21.6 12.4 20.4 12.4 C19.2 12.4 18.2 13.4 18.2 14.6 L18.2 14 C18.2 12.8 17.2 11.8 16 11.8 L16 6 C16 4.6 14.9 3.5 13.5 3.5 Z';
const AGENT_ARROW = 'M6 5 L6 21.5 L10.6 17.2 L18.5 17.2 Z';

function boxSvg(doc: Document) {
  return svg(doc, 'svg', { viewBox: `0 0 ${BOX} ${BOX}`, 'aria-hidden': 'true' });
}

export const CORE_CURSOR_THEMES: readonly CursorTheme[] = [
  {
    id: 'core:arrow',
    label: 'Arrow',
    description: 'The CUA-style pointer',
    feedback: 'ripple',
    tintable: true,
    create({ document: doc, color }) {
      // invariant: unchanged from the original overlay (the CUA arrow on its 128-unit canvas, styled by .replay-cursor rules).
      const root = svg(doc, 'svg', { viewBox: `0 0 ${CURSOR_CANVAS} ${CURSOR_CANVAS}` });
      const path = svg(doc, 'path', { d: CURSOR_PATH });
      if (color) (path as SVGElement).style.fill = color;
      root.append(path);
      const scale = BOX / CURSOR_CANVAS;
      return glyph(
        doc,
        { root, width: BOX, height: BOX, hotspot: { x: CURSOR_HOTSPOT.x * scale, y: CURSOR_HOTSPOT.y * scale } },
        'ripple',
        color ?? INK,
      );
    },
  },
  {
    id: 'core:classic-arrow',
    label: 'Classic arrow',
    description: 'A familiar desktop pointer',
    feedback: 'ripple',
    tintable: true,
    create({ document: doc, color }) {
      const root = boxSvg(doc);
      const path = svg(doc, 'path', { d: CLASSIC_ARROW });
      paint(path, color ?? INK, OUTLINE, 1.75);
      root.append(path);
      return glyph(doc, { root, width: BOX, height: BOX, hotspot: { x: 9, y: 5 } }, 'ripple', color ?? INK);
    },
  },
  {
    id: 'core:dot',
    label: 'Dot',
    description: 'A small, quiet dot',
    feedback: 'pulse',
    tintable: true,
    create({ document: doc, color }) {
      const fill = color ?? CURSOR_COLORS.accent;
      const root = boxSvg(doc);
      const dot = svg(doc, 'circle', { cx: 16, cy: 16, r: 5.5 });
      paint(dot, fill, OUTLINE, 2);
      root.append(dot);
      return glyph(doc, { root, width: BOX, height: BOX, hotspot: { x: 16, y: 16 } }, 'pulse', fill);
    },
  },
  {
    id: 'core:ring',
    label: 'Ring',
    description: 'A halo around the point',
    feedback: 'pulse',
    tintable: true,
    create({ document: doc, color }) {
      const tint = color ?? CURSOR_COLORS.accent;
      const root = boxSvg(doc);
      const halo = svg(doc, 'circle', { cx: 16, cy: 16, r: 10 });
      paint(halo, 'none', OUTLINE, 4.5);
      const ring = svg(doc, 'circle', { cx: 16, cy: 16, r: 10 });
      paint(ring, tint, tint, 2.25);
      (ring as SVGElement).style.fillOpacity = '0.16';
      const centre = svg(doc, 'circle', { cx: 16, cy: 16, r: 1.75 });
      paint(centre, tint, 'none', 0);
      root.append(halo, ring, centre);
      return glyph(doc, { root, width: BOX, height: BOX, hotspot: { x: 16, y: 16 } }, 'pulse', tint, [], [10, 20]);
    },
  },
  {
    id: 'core:hand',
    label: 'Pointer hand',
    description: 'The hand that hovers links',
    feedback: 'ripple',
    tintable: true,
    create({ document: doc, color }) {
      const root = boxSvg(doc);
      const path = svg(doc, 'path', { d: HAND });
      paint(path, color ?? OUTLINE, color ? OUTLINE : INK, 1.5);
      root.append(path);
      return glyph(doc, { root, width: BOX, height: BOX, hotspot: { x: 13.5, y: 3.5 } }, 'ripple', color ?? INK);
    },
  },
  {
    id: 'core:agent',
    label: 'Agent',
    description: 'A pointer with a name tag',
    feedback: 'press',
    tintable: true,
    create({ document: doc, color, label }) {
      const fill = color ?? CURSOR_COLORS.accent;
      const root = boxSvg(doc);
      const path = svg(doc, 'path', { d: AGENT_ARROW });
      paint(path, fill, OUTLINE, 1.5);
      root.append(path);
      const tag = doc.createElement('span');
      tag.className = 'replay-cursor-tag';
      tag.textContent = label;
      tag.style.cssText =
        `position:absolute;left:15px;top:19px;padding:1px 7px;border:1.5px solid ${OUTLINE};border-radius:999px;` +
        `background:${fill};color:${readableOn(fill)};font:600 11px/15px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;` +
        `letter-spacing:0;white-space:nowrap;box-shadow:0 1px 2px rgb(0 0 0 / 0.25)`;
      return glyph(doc, { root, width: BOX, height: BOX, hotspot: { x: 6, y: 5 } }, 'press', fill, [tag]);
    },
  },
];

const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]{1,4000}$/;
const PAINT = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|none)$/i;
const FEEDBACK = new Set(['ripple', 'pulse', 'press']);

const positive = (value: unknown, max: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max;

/** A plugin's vector theme, validated: anything off is refused rather than half-drawn. */
export function shapesTheme(id: string, definition: CursorShapesDefinition): CursorTheme {
  const fail = (problem: string): never => {
    throw new TypeError(`${id}: ${problem}`);
  };
  const { viewBox, size, hotspot, shapes } = definition;
  if (!Array.isArray(viewBox) || viewBox.length !== 2 || !viewBox.every((v) => positive(v, 1024))) fail('viewBox must be [width, height]');
  if (!Array.isArray(size) || size.length !== 2 || !size.every((v) => positive(v, 128))) fail('size must be [width, height] up to 128 px');
  if (!Array.isArray(hotspot) || hotspot.length !== 2 || !hotspot.every((v, i) => typeof v === 'number' && v >= 0 && v <= viewBox[i]!))
    fail('hotspot must be inside the viewBox');
  if (!Array.isArray(shapes) || !shapes.length || shapes.length > 16) fail('shapes must list 1 to 16 paths');
  for (const shape of shapes) {
    if (typeof shape?.d !== 'string' || !PATH_DATA.test(shape.d)) fail('each shape needs SVG path data');
    for (const value of [shape.fill, shape.stroke])
      if (value !== undefined && !PAINT.test(value)) fail('paints must be #rgb, #rrggbb or none');
    if (shape.strokeWidth !== undefined && !(typeof shape.strokeWidth === 'number' && shape.strokeWidth >= 0 && shape.strokeWidth <= 64))
      fail('strokeWidth must be 0 to 64');
    if (shape.tint !== undefined && shape.tint !== 'fill' && shape.tint !== 'stroke') fail("tint must be 'fill' or 'stroke'");
  }
  if (definition.feedback !== undefined && !FEEDBACK.has(definition.feedback)) fail('feedback must be ripple, pulse or press');
  const feedback = definition.feedback ?? 'ripple';
  const [vw, vh] = viewBox;
  const [w, h] = size;
  return {
    id,
    label: definition.label,
    description: definition.description ?? '',
    feedback,
    tintable: shapes.some((shape) => shape.tint),
    create({ document: doc, color }) {
      const root = svg(doc, 'svg', { viewBox: `0 0 ${vw} ${vh}`, 'aria-hidden': 'true' });
      for (const shape of shapes) {
        const path = svg(doc, 'path', { d: shape.d });
        const fill = shape.tint === 'fill' && color ? color : (shape.fill ?? 'none');
        const stroke = shape.tint === 'stroke' && color ? color : (shape.stroke ?? 'none');
        paint(path, fill, stroke, shape.strokeWidth ?? 0);
        root.append(path);
      }
      const spot = { x: (hotspot[0] / vw) * w, y: (hotspot[1] / vh) * h };
      return glyph(doc, { root, width: w, height: h, hotspot: spot }, feedback, color ?? INK);
    },
  };
}

const cache = new WeakMap<object, CursorTheme | null>();
const warned = new Set<string>();

/** The theme a slot item renders: a built-in, a plugin's full theme, or plugin data. `null` when it is unusable. */
function themeOf(item: SlotDescriptor<CursorThemeContext, unknown>, context: CursorThemeContext): CursorTheme | null {
  const cached = cache.get(item);
  if (cached !== undefined) return cached;
  let theme: CursorTheme | null = null;
  try {
    const result = item.render(context) as Partial<CursorTheme> & Partial<CursorThemeDefinition>;
    if (typeof result?.label !== 'string' || !result.label.trim()) throw new TypeError(`${item.id}: a theme needs a label`);
    if (typeof result.create === 'function') theme = { ...(result as CursorTheme), id: item.id };
    else if (result.kind === 'shapes') theme = shapesTheme(item.id, result as CursorShapesDefinition);
    else if (result.kind === 'cua-lottie') theme = cuaLottieTheme(item.id, result as CuaLottieThemeDefinition);
    else throw new TypeError(`${item.id}: kind must be 'shapes' or 'cua-lottie'`);
  } catch (error) {
    if (!warned.has(item.id)) console.warn('[replays] cursor theme skipped:', error);
    warned.add(item.id);
  }
  cache.set(item, theme);
  return theme;
}

const CORE_ITEMS: readonly SlotDescriptor<CursorThemeContext, unknown>[] = CORE_CURSOR_THEMES.map((theme, index) => ({
  id: theme.id,
  order: (index + 1) * 100,
  render: () => theme,
}));

/** Every usable theme, in slot order (built-ins first unless a deployment reorders them). */
export function cursorThemes(context: CursorThemeContext = { surface: 'player' }): CursorTheme[] {
  return resolveSlot(CURSOR_THEMES_SLOT, CORE_ITEMS, context)
    .map((item) => themeOf(item, context))
    .filter((theme): theme is CursorTheme => theme !== null);
}

/** The theme for a saved `appearance`; the default arrow when it is unknown, hidden or not installed here. */
export function cursorTheme(appearance: string | undefined, context: CursorThemeContext = { surface: 'player' }): CursorTheme {
  const themes = cursorThemes(context);
  return (
    themes.find((theme) => theme.id === (appearance ?? DEFAULT_CURSOR_APPEARANCE)) ??
    themes.find((theme) => theme.id === DEFAULT_CURSOR_APPEARANCE) ??
    (CORE_CURSOR_THEMES[0] as CursorTheme)
  );
}

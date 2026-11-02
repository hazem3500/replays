import type { CursorGlyph, CursorTheme } from './cursor-themes.ts';
import { CURSOR_CANVAS, CURSOR_HOTSPOT, CURSOR_PATH } from './cursor-motion.ts';

/**
 * CUA Driver custom cursor themes as Replays cursor themes. A CUA theme is a dotLottie archive with a semantic
 * manifest at `cua/theme.json` (schema `cua.cursor-theme/2`, profile `cua-driver-actions-v2`: twelve action
 * animations on a 128 × 128 canvas at 30 fps, each at most 120 frames, 1,000 in all, with a still frame for reduced
 * motion), per trycua/cua libs/cua-driver/docs/cursor-themes.md. Replays draws two of the actions: `idle`'s still
 * frame at rest and `click` frame by frame during a press, chosen from replay time, so the video export is
 * frame-accurate. The archive is fetched from the registrant's URL and the Lottie player is loaded only when the
 * theme is first drawn; neither is bundled with Replays.
 */

/** Draws one frame of one animation of a dotLottie archive into a canvas (an adapter over a Lottie player). */
export interface CuaLottiePlayer {
  draw(canvas: HTMLCanvasElement, archive: ArrayBuffer, animation: string, frame: number): Promise<void>;
  release?(canvas: HTMLCanvasElement): void;
}

/** Plugin data: `registerSlotItem('cursor.themes', { …, render: () => ({ kind: 'cua-lottie', … }) })`. */
export interface CuaLottieThemeDefinition {
  kind: 'cua-lottie';
  label: string;
  description?: string;
  /** The `.lottie` archive (same origin or https). */
  src: string;
  /** Loads the player on first use, e.g. `() => import('./dotlottie-player.js').then((m) => m.player)`. */
  player: () => Promise<CuaLottiePlayer>;
}

export const CUA_THEME_ACTIONS = [
  'idle',
  'observe',
  'click',
  'drag',
  'scroll',
  'text',
  'key',
  'navigate',
  'app',
  'transfer',
  'record',
  'system',
] as const;

export interface CuaThemeManifest {
  schema: 'cua.cursor-theme/2';
  id: string;
  name: string;
  version: string;
  author?: string;
  license?: string;
  canvas: { width: 128; height: 128; fps: 30 };
  hotspot: { x: number; y: number };
  actions: Record<(typeof CUA_THEME_ACTIONS)[number], { animation: string; still_frame: number }>;
}

const MAX_ARCHIVE = 8 * 1024 * 1024;
const MAX_ENTRY = 4 * 1024 * 1024;
const MAX_ENTRIES = 256;
const MAX_FRAMES = 120;
const ANIMATION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const REVERSE_DNS = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const onCanvas = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 128;
const fail = (problem: string): never => {
  throw new TypeError(`CUA cursor theme: ${problem}`);
};
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, name: string, max = 120) =>
  typeof value === 'string' && value.trim() && value.length <= max ? value : fail(`${name} must be text of at most ${max} characters`);

/** Checks `cua/theme.json` against profile v2. V1 manifests are refused, as CUA Driver refuses them. */
export function parseCuaThemeManifest(value: unknown): CuaThemeManifest {
  if (!isObject(value)) return fail('theme.json must be an object');
  if (value.schema !== 'cua.cursor-theme/2') fail('schema must be "cua.cursor-theme/2" (rebuild v1 themes for profile v2)');
  const id = text(value.id, 'id');
  if (!REVERSE_DNS.test(id)) fail('id must be a reverse-DNS name');
  const compatibility = value.compatibility;
  if (!isObject(compatibility) || compatibility.profile !== 'cua-driver-actions-v2' || compatibility.semantics !== 2)
    fail('compatibility must be profile "cua-driver-actions-v2", semantics 2');
  const canvas = value.canvas;
  if (!isObject(canvas) || canvas.width !== 128 || canvas.height !== 128 || canvas.fps !== 30) fail('canvas must be 128 × 128 at 30 fps');
  const hotspot = value.hotspot;
  if (!isObject(hotspot) || !onCanvas(hotspot.x) || !onCanvas(hotspot.y)) return fail('hotspot must lie on the 128 × 128 canvas');
  const actions = value.actions;
  if (!isObject(actions)) return fail('actions must be an object');
  for (const action of CUA_THEME_ACTIONS) {
    const entry = actions[action];
    if (!isObject(entry) || typeof entry.animation !== 'string' || !ANIMATION_ID.test(entry.animation))
      fail(`actions.${action}.animation must name an animation`);
    const still = (entry as Record<string, unknown>).still_frame;
    if (!Number.isInteger(still) || (still as number) < 0 || (still as number) >= MAX_FRAMES)
      fail(`actions.${action}.still_frame must be a frame from 0 to ${MAX_FRAMES - 1}`);
  }
  for (const key of Object.keys(actions))
    if (!(CUA_THEME_ACTIONS as readonly string[]).includes(key)) fail(`actions.${key} is not a v2 action`);
  return {
    schema: 'cua.cursor-theme/2',
    id,
    name: text(value.name, 'name'),
    version: text(value.version, 'version', 40),
    ...(value.author !== undefined ? { author: text(value.author, 'author') } : {}),
    ...(value.license !== undefined ? { license: text(value.license, 'license') } : {}),
    canvas: { width: 128, height: 128, fps: 30 },
    hotspot: { x: hotspot.x as number, y: hotspot.y as number },
    actions: actions as CuaThemeManifest['actions'],
  };
}

/** The named entries of a ZIP archive (stored or deflated), bounded in size and count. */
export async function readZipEntries(bytes: Uint8Array, wanted: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  if (bytes.length > MAX_ARCHIVE) fail(`the archive is over ${MAX_ARCHIVE / 1024 / 1024} MB`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) fail('not a ZIP archive');
  const count = view.getUint16(end + 10, true);
  if (count > MAX_ENTRIES) fail(`more than ${MAX_ENTRIES} entries`);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) fail('broken central directory');
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) fail(`unsafe entry name ${name}`);
    if (!wanted(name)) continue;
    if (size > MAX_ENTRY) fail(`${name} is over ${MAX_ENTRY / 1024 / 1024} MB`);
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) fail(`broken entry ${name}`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + compressed);
    if (data.length !== compressed) fail(`truncated entry ${name}`);
    if (method === 0) out.set(name, data);
    else if (method === 8) {
      const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
      if (inflated.length !== size) fail(`${name} does not inflate to its size`);
      out.set(name, inflated);
    } else fail(`${name} uses an unsupported compression method`);
  }
  return out;
}

interface ClickTiming {
  /** First and past-the-last frame (Lottie `ip`/`op`) and frames per second. */
  ip: number;
  op: number;
  fr: number;
}

export interface CuaTheme {
  manifest: CuaThemeManifest;
  click: ClickTiming;
}

/**
 * Validates a `.lottie` archive as a CUA profile v2 theme: its `cua/theme.json`, that dotLottie's `manifest.json`
 * lists every referenced animation, that each animation exists within the frame limits, and reads the click timing.
 */
export async function readCuaTheme(archive: ArrayBuffer | Uint8Array): Promise<CuaTheme> {
  const bytes = archive instanceof Uint8Array ? archive : new Uint8Array(archive);
  const json = (entries: Map<string, Uint8Array>, name: string) => {
    const data = entries.get(name) ?? fail(`missing ${name}`);
    try {
      return JSON.parse(new TextDecoder().decode(data)) as unknown;
    } catch {
      return fail(`${name} is not JSON`);
    }
  };
  const head = await readZipEntries(bytes, (name) => name === 'cua/theme.json' || name === 'manifest.json');
  const manifest = parseCuaThemeManifest(json(head, 'cua/theme.json'));
  const listed = json(head, 'manifest.json');
  const ids = new Set(
    isObject(listed) && Array.isArray(listed.animations)
      ? listed.animations.map((entry: unknown) => (isObject(entry) ? entry.id : undefined))
      : [],
  );
  const animations = new Set(Object.values(manifest.actions).map((action) => action.animation));
  for (const id of animations) if (!ids.has(id)) fail(`manifest.json does not list animation ${id}`);
  const files = await readZipEntries(bytes, (name) =>
    [...animations].some((id) => name === `a/${id}.json` || name === `animations/${id}.json`),
  );
  let total = 0;
  let click: ClickTiming | undefined;
  for (const id of animations) {
    const data = json(files, files.has(`a/${id}.json`) ? `a/${id}.json` : `animations/${id}.json`);
    if (!isObject(data)) return fail(`animation ${id} is not an object`);
    const { ip, op, fr, w, h } = data;
    if (w !== 128 || h !== 128 || fr !== 30) fail(`animation ${id} must be 128 × 128 at 30 fps`);
    if (typeof ip !== 'number' || typeof op !== 'number' || !(op > ip) || op - ip > MAX_FRAMES)
      fail(`animation ${id} must have 1 to ${MAX_FRAMES} frames`);
    total += (op as number) - (ip as number);
    if (id === manifest.actions.click.animation) click = { ip: ip as number, op: op as number, fr: 30 };
  }
  if (total > 1000) fail('the theme has more than 1,000 frames');
  return { manifest, click: click as ClickTiming };
}

const SAFE_URL = (src: string) => {
  try {
    const url = new URL(src, typeof location === 'undefined' ? 'http://localhost/' : location.href);
    return url.protocol === 'https:' || (typeof location !== 'undefined' && url.origin === location.origin);
  } catch {
    return false;
  }
};

const BOX = 32;
const SCALE = BOX / 128;

/** A CUA `.lottie` theme. If the archive or the player fails, it draws the default arrow at the same hotspot. */
export function cuaLottieTheme(id: string, definition: CuaLottieThemeDefinition): CursorTheme {
  if (typeof definition.src !== 'string' || !SAFE_URL(definition.src))
    throw new TypeError(`${id}: src must be an https or same-origin URL`);
  if (typeof definition.player !== 'function') throw new TypeError(`${id}: player must load a CuaLottiePlayer`);
  let loaded: Promise<{ archive: ArrayBuffer; theme: CuaTheme; player: CuaLottiePlayer }> | undefined;
  const load = () =>
    (loaded ??= (async () => {
      const response = await fetch(definition.src);
      if (!response.ok) throw new Error(`${definition.src}: ${response.status}`);
      const archive = await response.arrayBuffer();
      const [theme, player] = await Promise.all([readCuaTheme(archive), definition.player()]);
      return { archive, theme, player };
    })());
  return {
    id,
    label: definition.label,
    description: definition.description ?? 'CUA cursor theme',
    feedback: 'press',
    tintable: false,
    lazy: true,
    create({ document: doc }): CursorGlyph {
      const canvas = doc.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      canvas.style.cssText = `position:absolute;left:0;top:0;width:${BOX}px;height:${BOX}px`;
      const root = doc.createElement('div');
      root.style.cssText = `position:relative;width:${BOX}px;height:${BOX}px`;
      root.append(canvas);
      const hotspot = { x: CURSOR_HOTSPOT.x * SCALE, y: CURSOR_HOTSPOT.y * SCALE };
      let drawn = '';
      let pending: Promise<void> = Promise.resolve();
      let destroyed = false;
      let failed = false;
      const fallback = (error: unknown) => {
        if (failed || destroyed) return;
        failed = true;
        console.warn(`[replays] ${id}: drawing the default arrow instead:`, error);
        const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${CURSOR_CANVAS} ${CURSOR_CANVAS}`);
        const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', CURSOR_PATH);
        svg.append(path);
        svg.style.cssText = `position:absolute;left:${hotspot.x - CURSOR_HOTSPOT.x * SCALE}px;top:${hotspot.y - CURSOR_HOTSPOT.y * SCALE}px;width:${BOX}px;height:${BOX}px`;
        root.replaceChildren(svg);
      };
      const draw = (press: number) => {
        pending = pending
          .then(load)
          .then(async ({ archive, theme, player }) => {
            if (destroyed || failed) return;
            const { idle, click } = theme.manifest.actions;
            const frame = press < 0 ? -1 : theme.click.ip + Math.floor((press * theme.click.fr) / 1000);
            const [animation, at] = frame >= 0 && frame < theme.click.op ? [click.animation, frame] : [idle.animation, idle.still_frame];
            const key = `${animation}@${at}`;
            if (key === drawn) return;
            await player.draw(canvas, archive, animation, at);
            drawn = key;
            const spot = { x: theme.manifest.hotspot.x * SCALE, y: theme.manifest.hotspot.y * SCALE };
            hotspot.x = spot.x;
            hotspot.y = spot.y;
          })
          .catch(fallback);
      };
      draw(-1);
      let lastPress = -1;
      return {
        nodes: [root],
        width: BOX,
        height: BOX,
        // why: the arrow's hotspot holds until the manifest is read; ReplayCursor re-reads it after ready().
        hotspot,
        feedback(press) {
          const bucket = press < 0 ? -1 : Math.floor((press * 30) / 1000);
          if (bucket === lastPress) return;
          lastPress = bucket;
          draw(press);
        },
        ready: () => pending,
        destroy() {
          destroyed = true;
          void loaded?.then(({ player }) => player.release?.(canvas)).catch(() => {});
        },
      };
    },
  };
}

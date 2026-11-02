// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CUA_THEME_ACTIONS, cuaLottieTheme, type CuaLottiePlayer, readCuaTheme } from '../src/client/cua-cursor-theme.ts';
import { CURSOR_PATH } from '../src/client/cursor-motion.ts';

/** A ZIP as CUA's tooling writes one: local headers, a central directory, stored or deflated entries. */
async function zip(files: Record<string, unknown>, deflate = false) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = encoder.encode(typeof content === 'string' ? content : JSON.stringify(content));
    const data = deflate
      ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
      : raw;
    const nameBytes = encoder.encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, deflate ? 8 : 0, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(10, deflate ? 8 : 0, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, raw.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const size = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Uint8Array(await new Blob([...chunks, ...central, new Uint8Array(end.buffer)] as BlobPart[]).arrayBuffer());
}

const theme = (patch: Record<string, unknown> = {}) => ({
  schema: 'cua.cursor-theme/2',
  id: 'com.example.cursor.studio',
  name: 'Studio Cursor',
  version: '1.0.0',
  license: 'MIT',
  compatibility: { profile: 'cua-driver-actions-v2', semantics: 2 },
  canvas: { width: 128, height: 128, fps: 30 },
  hotspot: { x: 40, y: 20 },
  actions: Object.fromEntries(CUA_THEME_ACTIONS.map((action) => [action, { animation: `action_${action}`, still_frame: 3 }])),
  ...patch,
});
const animation = (frames = 12) => ({ v: '5.7.0', fr: 30, ip: 0, op: frames, w: 128, h: 128, layers: [] });
const files = (patch: Record<string, unknown> = {}) => ({
  'manifest.json': { animations: CUA_THEME_ACTIONS.map((action) => ({ id: `action_${action}` })) },
  'cua/theme.json': theme(),
  ...Object.fromEntries(CUA_THEME_ACTIONS.map((action) => [`a/action_${action}.json`, animation()])),
  ...patch,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CUA cursor theme archives', () => {
  it('reads a valid profile v2 theme, stored or deflated, with its click timing', async () => {
    for (const deflate of [false, true]) {
      const read = await readCuaTheme(await zip(files(), deflate));
      expect(read.manifest.id).toBe('com.example.cursor.studio');
      expect(read.manifest.hotspot).toEqual({ x: 40, y: 20 });
      expect(read.click).toEqual({ ip: 0, op: 12, fr: 30 });
    }
  });

  it.each([
    ['v1 manifests', files({ 'cua/theme.json': theme({ schema: 'cua.cursor-theme/1' }) }), 'schema'],
    [
      'a missing action',
      files({ 'cua/theme.json': theme({ actions: { idle: { animation: 'action_idle', still_frame: 0 } } }) }),
      'actions.observe',
    ],
    ['the wrong canvas', files({ 'cua/theme.json': theme({ canvas: { width: 256, height: 256, fps: 30 } }) }), 'canvas'],
    ['an unlisted animation', files({ 'manifest.json': { animations: [] } }), 'does not list'],
    ['too many frames', files({ 'a/action_click.json': animation(121) }), 'frames'],
    ['a non-reverse-DNS id', files({ 'cua/theme.json': theme({ id: 'studio' }) }), 'reverse-DNS'],
  ])('refuses %s', async (_, archive, message) => {
    await expect(readCuaTheme(await zip(archive))).rejects.toThrow(message);
  });

  it('refuses archives that are not ZIPs or that escape their folder', async () => {
    await expect(readCuaTheme(new TextEncoder().encode('not a zip'))).rejects.toThrow('not a ZIP');
    await expect(readCuaTheme(await zip({ ...files(), '../cua/theme.json': theme() }))).rejects.toThrow('unsafe entry name');
  });
});

/** A CUA theme over a fetched archive and a recording player (fetch and the Lottie player are the boundaries). */
async function setup(player: Partial<CuaLottiePlayer> = {}) {
  const archive = await zip(files());
  const fetch = vi.fn<() => Promise<Response>>(async () => new Response(archive));
  vi.stubGlobal('fetch', fetch);
  const draws: string[] = [];
  const load = vi.fn<() => Promise<CuaLottiePlayer>>(async () => ({
    draw: async (_canvas: HTMLCanvasElement, _archive: ArrayBuffer, animationId: string, frame: number) => {
      draws.push(`${animationId}@${frame}`);
    },
    ...player,
  }));
  const definition = { kind: 'cua-lottie' as const, label: 'Studio', src: 'https://themes.example/studio.lottie', player: load };
  return { fetch, load, draws, cursor: cuaLottieTheme('plugin:acme:studio', definition) };
}

describe('CUA themes as replay cursors', () => {
  it('loads the archive and the player only when the theme is drawn', async () => {
    const { fetch, load, cursor } = await setup();
    expect(cursor.lazy).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    const glyph = cursor.create({ document, label: 'Agent' });
    await glyph.ready?.();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(glyph.hotspot).toEqual({ x: 10, y: 5 });
  });

  it('draws the idle still at rest and the click animation frame for the press age', async () => {
    const { draws, cursor } = await setup();
    const glyph = cursor.create({ document, label: 'Agent' });
    await glyph.ready?.();
    for (const press of [0, 100, 250, 399, 450, -1]) {
      glyph.feedback(press);
      await glyph.ready?.();
    }
    expect(draws).toEqual(['action_idle@3', 'action_click@0', 'action_click@3', 'action_click@7', 'action_click@11', 'action_idle@3']);
  });

  it('falls back to the default arrow when the player fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { cursor } = await setup({ draw: async () => Promise.reject(new Error('no wasm')) });
    const glyph = cursor.create({ document, label: 'Agent' });
    await glyph.ready?.();
    expect((glyph.nodes[0] as HTMLElement).querySelector('path')!.getAttribute('d')).toBe(CURSOR_PATH);
  });

  it('refuses archive URLs other than https or same origin', () => {
    expect(() =>
      cuaLottieTheme('plugin:acme:x', {
        kind: 'cua-lottie',
        label: 'X',
        src: 'javascript:alert(1)',
        player: async () => ({ draw: async () => {} }),
      }),
    ).toThrow('src');
  });
});

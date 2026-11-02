// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CORE_CURSOR_APPEARANCES, CURSOR_COLORS, CURSOR_COLOR_NAMES, normalizeCursor } from '../src/shared/cursor.ts';
import { applyEdits, assertReplayEdits, editsVersion, isEmptyEdits, normalizeEdits, type ReplayEdits } from '../src/shared/edits.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import { buildCursorTrack, CLICK_FX_MS, cursorInput, cursorPose, CURSOR_PATH } from '../src/client/cursor-motion.ts';
import { contrastRatio, CURSOR_THEMES_SLOT, cursorTheme, cursorThemes, readableOn } from '../src/client/cursor-themes.ts';
import { viewerRegistry } from '../src/client/plugins/registry.ts';
import { ReplayCursor } from '../src/client/replay-cursor.ts';

const move = (t: number, x: number, y: number) => ({ type: 3, timestamp: t, data: { source: 1, positions: [{ x, y, timeOffset: 0 }] } });
const down = (t: number, x: number, y: number) => ({ type: 3, timestamp: t, data: { source: 2, type: 1, x, y } });
const events = [
  { type: 4, timestamp: 0, data: { width: 800, height: 600 } },
  move(100, 100, 100),
  move(2000, 400, 300),
  down(2100, 400, 300),
  move(5000, 200, 200),
];
const edits = (patch: Partial<ReplayEdits> = {}): ReplayEdits => ({ version: 1, cuts: [], ...patch });
const SHAPES = {
  kind: 'shapes',
  label: 'Plus',
  viewBox: [10, 10],
  size: [20, 20],
  hotspot: [5, 5],
  shapes: [{ d: 'M5 0 L5 10 M0 5 L10 5', stroke: '#000000', strokeWidth: 2, tint: 'stroke' }],
};

function mount(settings: ReplayEdits['cursor'], label?: string) {
  const host = document.createElement('div');
  document.body.append(host);
  const cursor = new ReplayCursor(host, events, 0, settings, label ? { label } : {});
  return { host, cursor, element: host.querySelector<HTMLElement>('.replay-cursor')! };
}

afterEach(() => {
  viewerRegistry.reset();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('saved appearance and colour', () => {
  it('drops the default arrow so existing edits stay byte-identical', () => {
    expect(normalizeCursor({ appearance: 'core:arrow' })).toBeUndefined();
    const before = normalizeEdits(edits({ cursor: { size: 1.35, motionStyle: 'magnetic' } }));
    const after = normalizeEdits(edits({ cursor: { size: 1.35, motionStyle: 'magnetic', appearance: 'core:arrow' } }));
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(isEmptyEdits(edits({ cursor: { appearance: 'core:arrow' } }))).toBe(true);
  });

  it('keeps other themes and colours as edits that change the export version', () => {
    const versions = new Set<string>();
    for (const appearance of [...CORE_CURSOR_APPEARANCES.slice(1), 'plugin:acme:studio']) {
      const list = edits({ cursor: { appearance, color: 'green' } });
      expect(() => assertReplayEdits(list)).not.toThrow();
      expect(normalizeEdits(list).cursor).toEqual({ appearance, color: 'green' });
      versions.add(editsVersion(list));
    }
    expect(versions.size).toBe(6);
    expect(editsVersion(edits({ cursor: { color: 'coral' } }))).not.toBe(editsVersion(edits({ cursor: { color: 'amber' } })));
  });

  it('rejects unknown themes and colours in the validator and the published schema', async () => {
    const ajv = new Ajv2020.default({ strict: false, allErrors: true });
    (addFormats as unknown as { default: (a: unknown) => void }).default(ajv);
    const validate = ajv.compile(JSON.parse(await readFile(join(import.meta.dirname, '../docs/formats/edits.schema.json'), 'utf8')));
    for (const cursor of [{ appearance: 'core:arrow' }, { appearance: 'plugin:user:me:neon' }, { color: 'graphite' as const }]) {
      expect(validate(edits({ cursor }))).toBe(true);
    }
    for (const [field, cursor] of [
      ['appearance', { appearance: 'core:sparkle' }],
      ['appearance', { appearance: 'plugin:Acme:x' }],
      ['appearance', { appearance: 'arrow' }],
      ['appearance', { appearance: 7 }],
      ['color', { color: 'red' }],
      ['color', { color: '#ff0000' }],
    ] as const) {
      expect(() => assertReplayEdits({ ...edits(), cursor: cursor as never })).toThrow(`edits.cursor.${field}`);
      expect(validate({ ...edits(), cursor })).toBe(false);
    }
  });
});

describe('cursor themes in the player', () => {
  it('draws the default arrow exactly as the original overlay did', () => {
    const { element, cursor } = mount(undefined);
    const drawn = [...element.children].filter((node) => (node as HTMLElement).style.display !== 'none');
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.getAttribute('viewBox')).toBe('0 0 128 128');
    expect(drawn[0]!.querySelector('path')!.getAttribute('d')).toBe(CURSOR_PATH);
    expect(drawn[0]!.querySelector('path')!.getAttribute('style')).toBeNull();
    expect([
      element.style.width,
      element.style.height,
      element.style.marginLeft,
      element.style.marginTop,
      element.style.transformOrigin,
    ]).toEqual(['32px', '32px', '-13.75px', '-7.5px', '13.75px 7.5px']);
    cursor.destroy();
  });

  it('draws click feedback from replay time, the same frame in any seek order, as export plans it', () => {
    const settings = { appearance: 'core:dot', color: 'coral' } as const;
    const { element, cursor } = mount(settings);
    const effect = element.querySelector<SVGElement>('svg[style*="position"]')!;
    const at = (t: number) => {
      cursor.update(t);
      return `${effect.style.display}|${effect.querySelector('circle')!.getAttribute('r')}|${(effect.querySelector('circle') as SVGElement).style.opacity}`;
    };
    const times = [2050, 2100, 2200, 2350, 2600, 3000];
    const forward = times.map(at);
    const backward = times.toReversed().map(at).toReversed();
    expect(backward).toEqual(forward);
    expect(forward[0]).toMatch(/^none/);
    expect(forward[2]).toMatch(/^block/);
    expect(forward.at(-1)).toMatch(/^none/);
    // invariant: export renders through this same ReplayCursor; its dirty-frame key reads the same pose.press.
    const exportTrack = buildCursorTrack(
      cursorInput(
        applyEdits(
          { events, meta: { duration: 6000 }, steps: [], console: [], network: [] } as unknown as ReplayBundle,
          edits({ cursor: settings }),
        ).bundle.events,
      ),
      { settings },
    );
    expect(cursorPose(exportTrack, 2200).press).toBe(100);
    expect(cursorPose(exportTrack, 2100 + CLICK_FX_MS).press).toBe(-1);
    cursor.destroy();
  });

  it('shows no ripple or pulse under reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      addEventListener() {},
      removeEventListener() {},
    }));
    const { element, cursor } = mount({ appearance: 'core:hand' });
    cursor.update(2200);
    expect(element.querySelector<SVGElement>('svg[style*="position"]')!.style.display).toBe('none');
    cursor.destroy();
  });

  it('tags the agent cursor with the replay source in text that clears 4.5:1 on every swatch', () => {
    const { element, cursor } = mount({ appearance: 'core:agent', color: 'amber' }, 'Human');
    expect(element.querySelector('.replay-cursor-tag')!.textContent).toBe('Human');
    for (const name of CURSOR_COLOR_NAMES)
      expect(contrastRatio(CURSOR_COLORS[name], readableOn(CURSOR_COLORS[name]))).toBeGreaterThanOrEqual(4.5);
    cursor.destroy();
  });

  it('draws a saved plugin theme once its plugin registers, and the arrow until then', () => {
    const { element, cursor } = mount({ appearance: 'plugin:acme:plus', color: 'green' });
    expect(element.querySelector('path')!.getAttribute('d')).toBe(CURSOR_PATH);
    viewerRegistry.apiFor('acme').registerSlotItem(CURSOR_THEMES_SLOT, { id: 'plugin:acme:plus', order: 1000, render: () => SHAPES });
    const path = [...element.querySelectorAll('path')].find((node) => node.getAttribute('d') === SHAPES.shapes[0]!.d)!;
    expect(path.style.stroke).toBe(CURSOR_COLORS.green);
    expect([element.style.width, element.style.marginLeft]).toEqual(['20px', '-10px']);
    cursor.destroy();
  });

  it('skips a malformed plugin theme without hiding the others', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    viewerRegistry.apiFor('acme').registerSlotItem(CURSOR_THEMES_SLOT, {
      id: 'plugin:acme:bad',
      order: 1000,
      render: () => ({ ...SHAPES, shapes: [{ d: '<script>' }] }),
    });
    expect(cursorThemes().map((theme) => theme.id)).toEqual([...CORE_CURSOR_APPEARANCES]);
    expect(cursorTheme('plugin:acme:bad').id).toBe('core:arrow');
  });
});

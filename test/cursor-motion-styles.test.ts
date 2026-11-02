// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import { CURSOR_MOTION_STYLES, normalizeCursor } from '../src/shared/cursor.ts';
import { applyEdits, assertReplayEdits, editsVersion, isEmptyEdits, normalizeEdits, type ReplayEdits } from '../src/shared/edits.ts';
import { IDENTITY_TIME, playbackEffects } from '../src/shared/effects.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import {
  buildCursorTrack,
  cursorInput,
  cursorPose,
  cursorTargets,
  onPage,
  planMove,
  REST_HEADING,
  sampleTrajectory,
} from '../src/client/cursor-motion.ts';
import { ReplayCursor } from '../src/client/replay-cursor.ts';

const pose = () => ({ visible: false, x: 0, y: 0, heading: 0, scale: 1, opacity: 1 });
const move = (t: number, x: number, y: number) => ({ type: 3, timestamp: t, data: { source: 1, positions: [{ x, y, timeOffset: 0 }] } });
const down = (t: number, x: number, y: number) => ({ type: 3, timestamp: t, data: { source: 2, type: 1, x, y } });

/** Rests far apart (room for every style), close together (compressed), a long move and overlapping hand-offs. */
const events = [
  { type: 4, timestamp: 0, data: { width: 1600, height: 1000 } },
  move(100, 200, 200),
  move(3000, 700, 450),
  down(3010, 700, 450),
  move(3200, 760, 430),
  move(3400, 120, 900),
  move(6000, 1500, 80),
  down(6005, 1500, 80),
  move(6060, 1420, 140),
  move(6230, 1480, 300),
  move(9000, 400, 600),
];
const input = cursorInput(events);
const targets = cursorTargets(onPage(input.points, input.viewport));

describe('CUA motion styles', () => {
  it('every style starts and lands exactly on the endpoints, upright, the same way every time', () => {
    for (const style of CURSOR_MOTION_STYLES) {
      for (const [from, to] of [
        [{ x: 10, y: 20 }, { x: 610, y: 320 }],
        [{ x: 100, y: 100 }, { x: 140, y: 100 }],
        [{ x: 50, y: 900 }, { x: 1500, y: 60 }],
      ] as const) {
        const traj = planMove(from, to, { style, seed: 'a' });
        const start = sampleTrajectory(traj, 0, pose());
        const end = sampleTrajectory(traj, traj.durationMs, pose());
        expect([start.x, start.y]).toEqual([from.x, from.y]);
        expect([end.x, end.y]).toEqual([to.x, to.y]);
        const arrived = sampleTrajectory(traj, traj.arrivalMs, pose());
        expect(Math.hypot(arrived.x - to.x, arrived.y - to.y)).toBeLessThanOrEqual(1);
        expect(traj.arrivalMs).toBeLessThanOrEqual(traj.durationMs);
        for (let i = 3; i < traj.samples.length; i += 4) expect(traj.samples[i]).toBe(REST_HEADING);
        expect(planMove(from, to, { style, seed: 'a' })).toEqual(traj);
      }
    }
  });

  it('keeps signature_arc the default and gives each style its own path', () => {
    const from = { x: 0, y: 300 };
    const to = { x: 600, y: 300 };
    expect(planMove(from, to, { style: 'signature_arc' })).toEqual(planMove(from, to));
    const mids = CURSOR_MOTION_STYLES.map((style) => {
      const traj = planMove(from, to, { style });
      return [traj.durationMs, sampleTrajectory(traj, traj.arrivalMs / 2, pose()).y].join();
    });
    expect(new Set(mids).size).toBe(CURSOR_MOTION_STYLES.length);
  });

  it('uses Cua timing per style', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 400, y: 0 };
    const fitts = 150 + 120 * Math.log2(400 / 24 + 1);
    // Arc styles: the shared Fitts model times 1.1, 1.35 and 1.15.
    expect(planMove(from, to, { style: 'signature_arc' }).durationMs).toBeCloseTo(fitts * 1.1, 6);
    expect(planMove(from, to, { style: 'spring_settle' }).durationMs).toBeCloseTo(fitts * 1.35, 6);
    expect(planMove(from, to, { style: 'comet_swoop' }).durationMs).toBeCloseTo(fitts * 1.15, 6);
    // adaptive up to 900 pt: `fitts_minjerk`, 50 + 150 log2(D / 24 + 1) ms clamped 180..1400.
    expect(planMove(from, to, { style: 'adaptive' }).durationMs).toBeCloseTo(50 + 150 * Math.log2(400 / 24 + 1), 6);
    // Spring settle reaches the target before its wobble (glide ends at 68%).
    const spring = planMove(from, to, { style: 'spring_settle' });
    expect(spring.arrivalMs).toBeLessThan(spring.durationMs * 0.75);
  });

  it('seeds adaptive long moves from the move identity, never the clock', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 1400, y: 300 };
    const a = planMove(from, to, { style: 'adaptive', seed: '3:1400,300' });
    expect(planMove(from, to, { style: 'adaptive', seed: '3:1400,300' })).toEqual(a);
    const differs = ['1', '2', '4', '5', '6', '7'].some(
      (seed) => JSON.stringify(planMove(from, to, { style: 'adaptive', seed }).samples) !== JSON.stringify(a.samples),
    );
    expect(differs).toBe(true);
    // keynote_swoop: 350 + 0.35 D ms, clamped 450..1100.
    expect(a.durationMs).toBeCloseTo(Math.min(Math.max(350 + 0.35 * Math.hypot(1400, 300), 450), 1100), 6);
  });

  it('magnetic slows near the target, then is pulled in', () => {
    const traj = planMove({ x: 0, y: 0 }, { x: 600, y: 0 }, { style: 'magnetic' });
    const s = traj.samples;
    // Per-step speed (samples are 120 Hz): cruise, the slow approach to the 40 pt snap radius, the pull.
    const steps: number[] = [];
    for (let i = 4; i < s.length; i += 4) steps.push((s[i + 1] as number) - (s[i - 3] as number));
    const cruise = Math.max(...steps);
    const approach = Math.min(...steps.slice(steps.indexOf(cruise)));
    expect(approach).toBeLessThan(cruise / 2);
    expect(steps.at(-1)!).toBeGreaterThan(approach * 2);
    expect(traj.arrivalMs).toBe(traj.durationMs);
  });

  it('classic rings out around the target after arriving', () => {
    const traj = planMove({ x: 0, y: 300 }, { x: 500, y: 100 }, { style: 'classic' });
    let furthest = 0;
    for (let ms = traj.arrivalMs; ms <= traj.durationMs; ms += 4) {
      const p = sampleTrajectory(traj, ms, pose());
      furthest = Math.max(furthest, Math.hypot(p.x - 500, p.y - 100));
    }
    expect(furthest).toBeGreaterThan(1);
    expect(furthest).toBeLessThan(20);
  });

  it('reduced motion is the same short straight glide for every style', () => {
    const glide = planMove({ x: 0, y: 0 }, { x: 600, y: 0 }, { reducedMotion: true });
    for (const style of CURSOR_MOTION_STYLES) expect(planMove({ x: 0, y: 0 }, { x: 600, y: 0 }, { style, reducedMotion: true })).toEqual(glide);
    const reduced = buildCursorTrack(input, { reducedMotion: true });
    for (const style of CURSOR_MOTION_STYLES) {
      expect(buildCursorTrack(input, { reducedMotion: true, settings: { motionStyle: style } }).moves).toEqual(reduced.moves);
    }
  });
});

describe('styled replay tracks', () => {
  it('arrive on every recorded target at its timestamp, for every style', () => {
    for (const style of CURSOR_MOTION_STYLES) {
      const track = buildCursorTrack(input, { settings: { motionStyle: style } });
      expect(track.style).toBe(style);
      for (const target of targets.slice(1)) {
        const p = cursorPose(track, target.t);
        expect(Math.hypot(p.x - target.x, p.y - target.y), `${style} at ${target.t}`).toBeLessThanOrEqual(1.000_001);
      }
      // Settled at the end of the replay.
      const last = targets.at(-1)!;
      const end = cursorPose(track, 20_000);
      expect([end.x, end.y]).toEqual([last.x, last.y]);
    }
  });

  it('hands overlapping moves off from the prior pose without jumps', () => {
    for (const style of CURSOR_MOTION_STYLES) {
      const track = buildCursorTrack(input, { settings: { motionStyle: style, hideWhenIdle: false } });
      for (let i = 1; i < track.moves.length; i++) {
        const start = track.moves[i]!.start;
        const before = cursorPose(track, start - 1e-6);
        const after = cursorPose(track, start + 1e-6);
        expect(Math.hypot(after.x - before.x, after.y - before.y), `${style} move ${i}`).toBeLessThan(0.5);
      }
    }
  });

  it('is a pure function of replay time, in any seek order', () => {
    for (const style of CURSOR_MOTION_STYLES) {
      const settings = { motionStyle: style };
      const times = Array.from({ length: 400 }, (_, i) => i * 27.7);
      const track = buildCursorTrack(input, { settings });
      const forward = times.map((t) => ({ ...cursorPose(track, t) }));
      const fresh = buildCursorTrack(cursorInput(events), { settings });
      const backward = times
        .toReversed()
        .map((t) => ({ ...cursorPose(fresh, t) }))
        .toReversed();
      expect(backward).toEqual(forward);
    }
  });

  it('plans the export track exactly as the viewer track', () => {
    // render/main.ts plans from the bundle's effects; ReplayCursor plans from the same effects on the same events.
    const bundle = { events, meta: { duration: 9000 }, steps: [], console: [], network: [] } as unknown as ReplayBundle;
    const list = edits({ cursor: { motionStyle: 'comet_swoop' } });
    const effects = applyEdits(bundle, list).effects;
    expect(effects?.cursor).toEqual({ motionStyle: 'comet_swoop' });
    const exportTrack = buildCursorTrack(cursorInput(bundle.events), { settings: effects?.cursor });
    const host = document.createElement('div');
    const viewer = new ReplayCursor(host, events, 0, playbackEffects(list, IDENTITY_TIME(9000), events).cursor);
    try {
      const element = host.querySelector<HTMLElement>('.replay-cursor')!;
      for (const t of [3200, 3300, 5900, 6100, 6200]) {
        viewer.update(t);
        const p = cursorPose(exportTrack, t);
        expect(element.style.transform).toContain(`translate3d(${p.x.toFixed(2)}px,${p.y.toFixed(2)}px,0)`);
      }
      // Changing the style re-plans the mounted viewer track.
      viewer.update(3300);
      const comet = element.style.transform;
      viewer.setSettings({ motionStyle: 'classic' });
      expect(element.style.transform).not.toBe(comet);
      viewer.setSettings({ motionStyle: 'comet_swoop' });
      expect(element.style.transform).toBe(comet);
    } finally {
      viewer.destroy();
    }
  });
});

const edits = (patch: Partial<ReplayEdits> = {}): ReplayEdits => ({ version: 1, cuts: [], ...patch });

describe('saved motion style', () => {

  it('drops the default so existing edits stay byte-identical', () => {
    expect(normalizeCursor({ motionStyle: 'signature_arc' })).toBeUndefined();
    expect(normalizeCursor({ size: 1.5, motionStyle: 'signature_arc' })).toEqual({ size: 1.5 });
    const defaults = edits({ cursor: { motionStyle: 'signature_arc' } });
    expect(normalizeEdits(defaults)).toEqual(edits());
    expect(isEmptyEdits(defaults)).toBe(true);
    expect(editsVersion(defaults)).toBe('');
    expect(JSON.stringify(normalizeEdits(edits({ cursor: { size: 1.35, motionStyle: 'signature_arc' } })))).toBe(
      JSON.stringify(normalizeEdits(edits({ cursor: { size: 1.35 } }))),
    );
  });

  it('keeps the other styles, counts them as edits and versions exports by them', () => {
    const versions = new Set<string>();
    for (const style of CURSOR_MOTION_STYLES.filter((s) => s !== 'signature_arc')) {
      const list = edits({ cursor: { motionStyle: style } });
      expect(() => assertReplayEdits(list)).not.toThrow();
      expect(normalizeEdits(list).cursor).toEqual({ motionStyle: style });
      expect(isEmptyEdits(list)).toBe(false);
      versions.add(editsVersion(list));
    }
    expect(versions.size).toBe(5);
    expect(versions.has('')).toBe(false);
  });

  it('rejects unknown styles in the validator and the published schema', async () => {
    const ajv = new Ajv2020.default({ strict: false, allErrors: true });
    (addFormats as unknown as { default: (a: unknown) => void }).default(ajv);
    const validate = ajv.compile(JSON.parse(await readFile(join(import.meta.dirname, '../docs/formats/edits.schema.json'), 'utf8')));
    for (const style of CURSOR_MOTION_STYLES) expect(validate(edits({ cursor: { motionStyle: style } }))).toBe(true);
    for (const motionStyle of ['invented', 'Signature_Arc', '', 3, null, true]) {
      const list = { ...edits(), cursor: { motionStyle } };
      expect(() => assertReplayEdits(list)).toThrow('edits.cursor.motionStyle');
      expect(validate(list)).toBe(false);
    }
    expect(normalizeCursor({ motionStyle: 'invented' as never })).toBeUndefined();
  });
});

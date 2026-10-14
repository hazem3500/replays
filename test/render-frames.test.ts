import { describe, expect, it } from 'vitest';

import { dirtyFrames, exportMap, exportTimes, frameCount, frameTime, poseKey } from '../src/client/render/frames.ts';
import { INACTIVE_SKIP_SPEED } from '../src/shared/skip.ts';
import { CAPTION_IN_MS, captionAt, captionKey, exportCaptionScale } from '../src/client/step-caption.ts';

const still = () => 'still';
const movingCursor = (t: number) => (t >= 300 && t <= 500 ? `x${t}` : 'rest');

describe('frame plan', () => {
  it('covers the whole replay, the last frame landing on the end', () => {
    expect(frameCount(1000, 30, 1)).toBe(31);
    expect(frameCount(1000, 15, 2)).toBe(9);
    expect(frameCount(0, 30, 1)).toBe(1);
    expect(frameTime(30, 30, 1, 1000)).toBe(1000);
    expect(frameTime(8, 15, 2, 1000)).toBe(1000); // 1066.7 ms clamped
    expect(frameTime(1, 30, 2, 1000)).toBeCloseTo(66.667, 2);
  });

  it('captures the first frame and frames where an event landed in (previous, t]', () => {
    // 10 fps → frames at 0, 100, 200, …, 1000.
    const dirty = dirtyFrames({ duration: 1000, fps: 10, speed: 1, eventTimes: [0, 100, 150, 151, 700], cursorKey: still });
    expect(dirty).toEqual([0, 1, 2, 7]);
  });

  it('counts an event exactly on a frame for that frame, not the next', () => {
    expect(dirtyFrames({ duration: 300, fps: 10, speed: 1, eventTimes: [200], cursorKey: still })).toEqual([0, 2]);
  });

  it('captures frames where only the cursor moved', () => {
    expect(dirtyFrames({ duration: 1000, fps: 10, speed: 1, eventTimes: [], cursorKey: movingCursor })).toEqual([0, 3, 4, 5, 6]);
  });

  it('needs fewer captures at a higher speed', () => {
    const eventTimes = Array.from({ length: 100 }, (_, i) => i * 10);
    const normal = dirtyFrames({ duration: 1000, fps: 30, speed: 1, eventTimes, cursorKey: still });
    const fast = dirtyFrames({ duration: 1000, fps: 30, speed: 2, eventTimes, cursorKey: still });
    expect(fast.length).toBeLessThan(normal.length);
  });

  it('rounds cursor poses to what a frame can show', () => {
    const pose = { visible: true, x: 10.01, y: 20.04, heading: 0.7801, scale: 1 };
    expect(poseKey(pose)).toBe(poseKey({ ...pose, x: 10.04, heading: 0.7799 }));
    expect(poseKey(pose)).not.toBe(poseKey({ ...pose, x: 10.2 }));
    expect(poseKey({ ...pose, visible: false })).toBe('hidden');
  });
});

const steps = [
  { at: 300, label: 'Open settings' },
  { at: 700, label: 'Save' },
];
const stepCaptionKey = (time: number) => captionKey(captionAt(steps, time, 1000));

describe('step captions in exported frames', () => {
  it('captions the active step, entering when it starts (the first one from the start)', () => {
    expect(captionAt([], 100, 1000)).toBeUndefined();
    expect(captionAt(steps, 0, 1000)).toEqual({ index: 0, label: 'Open settings', enteredMs: 0 });
    expect(captionAt(steps, 100, 1000)).toMatchObject({ index: 0, enteredMs: 100 });
    // The first caption does not enter again when its step's own time comes.
    expect(captionAt(steps, 400, 1000)).toMatchObject({ index: 0, enteredMs: 400 });
    expect(captionAt(steps, 750, 1000)).toEqual({ index: 1, label: 'Save', enteredMs: 50 });
    // The entrance runs in output time: at 2× it covers twice the replay time.
    expect(captionAt(steps, 750, 1000, (time) => time / 2)).toMatchObject({ enteredMs: 25 });
    // At the end every step counts as reached, already settled.
    expect(captionAt([...steps, { at: 1005, label: 'Late' }], 1000, 1000)).toMatchObject({ index: 2, enteredMs: Infinity });
  });

  it('keys a caption by step while it enters, then by step alone', () => {
    expect(captionKey(undefined)).toBe('');
    expect(captionKey({ index: 1, label: 'Save', enteredMs: 50 })).not.toBe(captionKey({ index: 1, label: 'Save', enteredMs: 100 }));
    expect(captionKey({ index: 1, label: 'Save', enteredMs: CAPTION_IN_MS })).toBe(
      captionKey({ index: 1, label: 'Save', enteredMs: 5000 }),
    );
  });

  it('marks frames dirty when the caption changes, even with no event or cursor move', () => {
    // 10 fps, no events, a still cursor: frames 0–2 (the first caption entering, then settled), 7–9 (the second).
    expect(dirtyFrames({ duration: 1000, fps: 10, speed: 1, eventTimes: [], cursorKey: still })).toEqual([0]);
    expect(dirtyFrames({ duration: 1000, fps: 10, speed: 1, eventTimes: [], cursorKey: still, captionKey: stepCaptionKey })).toEqual([
      0, 1, 2, 7, 8, 9,
    ]);
  });
});

describe('export timeline (speed, skip inactive)', () => {
  it('plays at the chosen speed', () => {
    const map = exportMap({ duration: 1000, speed: 2 });
    expect(map.outputMs).toBe(500);
    expect(exportTimes(map, 10, 1000)).toEqual([0, 200, 400, 600, 800, 1000]);
    expect(exportTimes(exportMap({ duration: 1000, speed: 0.5 }), 10, 1000)).toHaveLength(21);
  });

  it('fast-forwards idle gaps at max(speed, INACTIVE_SKIP_SPEED), as the viewer does', () => {
    // 10 s replay, one idle gap 2–8 s: 2 s + 6 s / 16 + 2 s = 4.375 s of video at 1×.
    const map = exportMap({ duration: 10_000, speed: 1, gaps: [{ from: 2000, to: 8000 }] });
    expect(map.outputMs).toBeCloseTo(4000 + 6000 / INACTIVE_SKIP_SPEED, 6);
    expect(map.replayAt(2000)).toBe(2000);
    expect(map.replayAt(2000 + 3000 / INACTIVE_SKIP_SPEED)).toBeCloseTo(5000, 6);
    expect(map.outputAt(9000)).toBeCloseTo(3000 + 6000 / INACTIVE_SKIP_SPEED, 6);
    // Faster than the skip speed: the gap plays at the chosen speed.
    expect(exportMap({ duration: 10_000, speed: 32, gaps: [{ from: 2000, to: 8000 }] }).outputMs).toBeCloseTo(10_000 / 32, 6);
    const times = exportTimes(map, 10, 10_000);
    expect(times).toHaveLength(Math.ceil(map.outputMs / 100) + 1);
    expect(times.at(-1)).toBe(10_000);
    // Through the gap each frame advances 1.6 s of replay; outside it 100 ms.
    expect(times[21]! - times[20]!).toBeCloseTo(1600, 3);
    expect(times[1]).toBe(100);
  });

  it('marks dirty frames along the skipped timeline', () => {
    const gaps = [{ from: 1000, to: 9000 }];
    const plain = dirtyFrames({ duration: 10_000, fps: 10, speed: 1, eventTimes: [5000], cursorKey: still });
    const skipped = dirtyFrames({ duration: 10_000, fps: 10, speed: 1, eventTimes: [5000], cursorKey: still, gaps });
    expect(plain).toEqual([0, 50]);
    // 5 s lands 0.25 s into the skip: frame 10 (1 s) + 4000 / 1600 → frame 13 (1.0 + 3 × 1.6 = 5.8 s) is the first past it.
    expect(skipped).toEqual([0, 13]);
  });

  it('scales exported captions up with the recorded viewport, never below the viewer size', () => {
    expect(exportCaptionScale(1440)).toBe(1.6);
    expect(exportCaptionScale(1280)).toBeCloseTo(1.422, 3);
    expect(exportCaptionScale(390)).toBe(1);
    expect(exportCaptionScale(3840)).toBe(2.4);
    expect(exportCaptionScale(0)).toBe(1);
    // 22.4 px text, 28.8 px from the bottom at 1440 px.
    expect(14 * exportCaptionScale(1440)).toBeCloseTo(22.4, 5);
  });
});

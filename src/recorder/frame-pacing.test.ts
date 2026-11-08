// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureFramePacing } from './frame-pacing.ts';
import type { ReplayPerformanceTrack } from '../shared/replay.ts';

describe('foreground frame pacing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('excludes a background pause from the next foreground frame sample', () => {
    let callback: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => {
      callback = next;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn<typeof cancelAnimationFrame>());
    const track: ReplayPerformanceTrack = { supported: [], entries: [] };
    const stop = captureFramePacing(track, () => {});
    const tick = (at: number) => callback?.(at);
    tick(10);
    tick(510);
    document.dispatchEvent(new Event('visibilitychange'));
    tick(10_000);
    tick(10_500);
    tick(11_000);
    expect(track.frames).toEqual([{ at: performance.timeOrigin + 10_000, elapsed: 1000, frames: 2, dropped: 58 }]);
    stop();
  });

  it('ignores a queued frame callback after capture has stopped', () => {
    let callback: FrameRequestCallback | undefined;
    const request = vi.fn<typeof requestAnimationFrame>((next) => {
      callback = next;
      return 1;
    });
    const cancel = vi.fn<typeof cancelAnimationFrame>();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const track: ReplayPerformanceTrack = { supported: [], entries: [] };
    const stop = captureFramePacing(track, () => {});
    stop();
    callback?.(1000);
    expect(request).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith(1);
    expect(track.frames).toEqual([]);
  });
});

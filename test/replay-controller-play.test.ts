// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

import { ReplayController } from '../src/client/playback/controller.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';

vi.mock('rrweb', () => ({
  Replayer: class {
    wrapper = document.createElement('div');
    iframe = document.createElement('iframe');
    play = vi.fn<() => void>();
    pause = vi.fn<() => void>();
    destroy = vi.fn<() => void>();
    on = vi.fn<() => void>();
    getCurrentTime = () => 0;
    setConfig = vi.fn<() => void>();
  },
}));

const bundle: ReplayBundle = {
  meta: {
    id: 'one',
    title: 'One',
    url: 'https://example.com/',
    capturedAt: '2026-11-02T00:00:00.000Z',
    duration: 1000,
    viewport: { width: 800, height: 600 },
    eventCount: 2,
    version: 1,
  },
  events: [
    { type: 4, timestamp: 1000, data: { href: 'https://example.com/', width: 800, height: 600 } },
    { type: 2, timestamp: 2000, data: { node: { type: 0, id: 1, childNodes: [] }, initialOffset: { top: 0, left: 0 } } },
  ],
  steps: [],
  console: [],
  network: [],
};

describe('ReplayController play requests', () => {
  it('keeps a play pressed before the renderer is mounted and starts it on mount', () => {
    const controller = new ReplayController(bundle);
    controller.play();
    expect(controller.getState()).toMatchObject({ status: 'paused', starting: true });
    controller.mount(document.createElement('div'));
    expect(controller.getState()).toMatchObject({ status: 'playing', starting: false });
  });

  it('drops a queued play when pause is pressed before the mount', () => {
    const controller = new ReplayController(bundle);
    controller.play();
    controller.playPause();
    expect(controller.getState().starting).toBe(false);
    controller.mount(document.createElement('div'));
    expect(controller.getState().status).toBe('paused');
  });

  it('hands a play press to the hold of a pending run switch instead of playing', () => {
    const controller = new ReplayController(bundle);
    controller.mount(document.createElement('div'));
    const hold = { request: vi.fn<() => void>(), cancel: vi.fn<() => void>() };
    controller.setPlayHold(hold);
    controller.play();
    expect(hold.request).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({ status: 'paused', starting: true });
    controller.pause();
    expect(hold.cancel).toHaveBeenCalledTimes(1);
    expect(controller.getState().starting).toBe(false);
  });

  it('plays normally again once the hold is released', () => {
    const controller = new ReplayController(bundle);
    controller.mount(document.createElement('div'));
    controller.setPlayHold({ request: vi.fn<() => void>(), cancel: vi.fn<() => void>() });
    controller.setPlayHold(undefined);
    controller.play();
    expect(controller.getState().status).toBe('playing');
  });
});

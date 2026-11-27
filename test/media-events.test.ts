// @vitest-environment jsdom
import { Replayer } from 'rrweb';
import { describe, expect, it } from 'vitest';

import { withoutForeignMediaEvents } from '../src/client/playback/media-events.ts';
import { rrwebEvents } from '../src/client/playback/rrweb-wire.ts';
import { isRecord } from '../src/shared/validate.ts';

const START = 1_000_000;
const element = (id: number, tagName: string, childNodes: unknown[] = []) => ({ type: 2, id, tagName, attributes: {}, childNodes });
const text = (id: number, textContent: string) => ({ type: 3, id, textContent });
const pausedMedia = (at: number, id: number) => ({
  type: 3,
  timestamp: START + at,
  data: { source: 7, type: 1, id, currentTime: 0, volume: 1, muted: true, playbackRate: 1, loop: false },
});

/** A page with a player component (a custom element that dispatches its own `pause` event) and a real video. */
function recording() {
  const body = element(10, 'body', [element(5, 'div', [text(6, 'before')]), element(52, 'video-player'), element(60, 'video')]);
  const node = { type: 0, id: 1, childNodes: [element(3, 'html', [element(4, 'head'), body])] };
  return [
    { type: 4, timestamp: START, data: { href: 'https://a.test/', width: 800, height: 600 } },
    { type: 2, timestamp: START + 10, data: { node, initialOffset: { top: 0, left: 0 } } },
    pausedMedia(200, 52),
    pausedMedia(250, 60),
    {
      type: 3,
      timestamp: START + 1000,
      data: { source: 0, adds: [{ parentId: 5, nextId: null, node: text(7, ' after') }], removes: [], texts: [], attributes: [] },
    },
  ];
}

describe('media interactions the player can replay', () => {
  it('drops those on elements that are not audio or video and keeps the rest', () => {
    const media = withoutForeignMediaEvents(recording()).flatMap(({ type, data }) =>
      type === 3 && isRecord(data) && data.source === 7 ? [data.id] : [],
    );
    expect(media).toEqual([60]);
  });

  it('knows elements added after the snapshot', () => {
    const events = [
      ...recording().slice(0, 2),
      {
        type: 3,
        timestamp: START + 100,
        data: { source: 0, adds: [{ parentId: 10, nextId: null, node: element(70, 'my-player') }], removes: [], texts: [], attributes: [] },
      },
      pausedMedia(200, 70),
    ];
    expect(withoutForeignMediaEvents(events)).toHaveLength(3);
  });

  it('keeps paused seeks rendering when a player component recorded its own pause event', () => {
    const root = document.createElement('div');
    document.body.append(root);
    // why: jsdom's iframe fails rrweb's sandbox check, which only the unprotected-rebuild escape hatch skips.
    const replayer = new Replayer(rrwebEvents(withoutForeignMediaEvents(recording())), {
      root,
      mouseTail: false,
      UNSAFE_replayCanvas: true,
    });
    replayer.pause(500);
    replayer.pause(1500);
    expect(replayer.iframe.contentDocument?.body.textContent).toBe('before after');
    replayer.destroy();
    root.remove();
  });
});

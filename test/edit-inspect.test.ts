import { afterEach, describe, expect, it } from 'vitest';

import { inspectReplay } from '../src/edit/inspect.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import { boot, closeServers } from './edit-cli-harness.ts';
import { replay } from './fixtures.ts';

const START = 1_000_000;
const element = (id: number, tagName: string, childNodes: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  type: 2,
  id,
  tagName,
  attributes: {},
  childNodes,
  ...extra,
});
const mutation = (at: number, data: Record<string, unknown>) => ({
  type: 3,
  timestamp: START + at,
  data: { source: 0, adds: [], removes: [], texts: [], attributes: [], ...data },
});

/** Two documents; the first has a player component whose shadow root holds an iframe. */
function bundle(): ReplayBundle {
  const player = element(52, 'x-player', [element(53, 'div', [element(56, 'iframe')], { isShadow: true })], { isShadowHost: true });
  const page = (href: string, at: number, body: unknown[]) => [
    { type: 4, timestamp: START + at, data: { href, width: 800, height: 600 } },
    {
      type: 2,
      timestamp: START + at + 10,
      data: { node: { type: 0, id: 1, childNodes: [element(3, 'html', [element(4, 'head'), element(10, 'body', body)])] } },
    },
  ];
  return {
    ...replay('inspected'),
    events: [
      ...page('https://a.test/', 0, [element(5, 'aside'), player]),
      { type: 3, timestamp: START + 200, data: { source: 7, type: 1, id: 52 } },
      mutation(1000, { attributes: [{ id: 5, attributes: { style: 'opacity: 0' } }] }),
      mutation(1500, {
        attributes: [
          { id: 53, attributes: { class: 'open' } },
          { id: 99, attributes: { class: 'gone' } },
        ],
      }),
      ...page('https://b.test/', 3000, [element(5, 'main')]),
      mutation(4000, { texts: [{ id: 5, value: 'x' }] }),
    ],
  };
}

describe('replays edit inspect', () => {
  afterEach(closeServers);

  it('names the document and render offset a paused seek uses', () => {
    const [early, late] = inspectReplay(bundle(), [1200, 3500]).moments;
    expect(early).toMatchObject({ renderOffset: 1201, document: 0, href: 'https://a.test/', rebuildFrom: 0 });
    expect(late).toMatchObject({ renderOffset: 3501, document: 1, href: 'https://b.test/', rebuildFrom: 3000 });
  });

  it('places applied mutations in the page, a shadow root or a frame, and counts those naming missing nodes', () => {
    const [moment] = inspectReplay(bundle(), [2000]).moments;
    expect(moment?.applied.byPlace).toEqual({ page: 1, shadow: 1, frame: 0 });
    expect(moment?.missingNodes).toBe(1);
    expect(moment?.mostChanged.map((node) => `${node.tag} ${node.place} ${node.attributes.join()}`)).toEqual([
      'aside page style',
      'div shadow class',
    ]);
  });

  it('flags media interactions on elements the player cannot replay', () => {
    expect(inspectReplay(bundle()).media).toEqual([{ at: 200, id: 52, tag: 'x-player', place: 'page', playable: false }]);
  });

  it('reads the replay from the server and refuses a time past its end', async () => {
    const { run } = await boot();
    const shown = await run(['inspect', '--at', '5s', '--json']);
    expect(shown).toMatchObject({ success: true, id: 'edit-me', duration: 30_000, moments: [expect.objectContaining({ time: 5000 })] });
    await expect(run(['inspect', '--at', '31s'])).rejects.toThrow('--at must be within the replay');
  });
});

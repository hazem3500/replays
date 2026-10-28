// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Poster, resetPosters } from '../src/client/index/Poster.tsx';
import { rgbaToThumbHash, thumbHashToBase64 } from '../src/shared/thumbhash-encode.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const blue = thumbHashToBase64(
  rgbaToThumbHash(
    16,
    10,
    new Uint8Array(16 * 10 * 4).map((_, i) => [40, 90, 220, 255][i % 4] ?? 0),
  ),
);

function required<T>(value: T | null): T {
  if (value === null) throw new Error('Expected the element to be rendered');
  return value;
}

describe('poster ThumbHash placeholder', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    resetPosters();
  });

  function placeholder(thumbhash?: string) {
    act(() => {
      root.render(createElement(Poster, { id: 'demo', host: 'sample.test', thumbhash }));
    });
    return required(host.querySelector<HTMLElement>('.poster-placeholder'));
  }

  it('paints the poster’s colours while the image loads', () => {
    const tile = placeholder(blue);
    expect(tile.hasAttribute('data-thumbhash')).toBe(true);
    expect(tile.style.backgroundImage).toMatch(/^url\("?data:image\/png;base64,/);
    expect(tile.textContent).toBe('');
  });

  it('keeps the host’s initial for a replay without a ThumbHash', () => {
    const tile = placeholder();
    expect(tile.hasAttribute('data-thumbhash')).toBe(false);
    expect(tile.textContent).toBe('S');
  });

  it('keeps the host’s initial when the stored hash is malformed', () => {
    const tile = placeholder('not a hash!');
    expect(tile.hasAttribute('data-thumbhash')).toBe(false);
    expect(tile.textContent).toBe('S');
  });
});

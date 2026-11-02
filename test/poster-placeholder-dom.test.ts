// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Poster, resetPosters } from '../src/client/index/Poster.tsx';
import { rgbaToThumbHash, thumbHashToBase64 } from '../src/shared/thumbhash-encode.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const hash = thumbHashToBase64(rgbaToThumbHash(8, 5, new Uint8Array(8 * 5 * 4).fill(180)));

describe('poster placeholder', () => {
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

  function render(element: ReturnType<typeof createElement>) {
    act(() => {
      root.render(element);
    });
  }

  it('shows the recorded host on a calm page, never a letter, and fetches nothing from it', () => {
    render(createElement(Poster, { id: 'demo', host: 'www.shop.example', size: 'card' }));
    expect(host.querySelector('.poster-site-host')?.textContent).toBe('shop.example');
    expect(host.querySelector('.poster-placeholder img')).toBeNull();
    expect(host.querySelector('svg.poster-site-icon')).not.toBeNull();
  });

  it('leaves the host out when there is none', () => {
    render(createElement(Poster, { id: 'demo', host: '', size: 'card' }));
    expect(host.querySelector('.poster-site-host')).toBeNull();
    expect(host.querySelector('svg.poster-site-icon')).not.toBeNull();
  });

  it('uses the leading replay’s ThumbHash without splitting the thumbnail into run tiles', () => {
    render(createElement(Poster, { id: undefined, host: 'shop.example', thumbhash: hash, size: 'card' }));
    expect(host.querySelector('.poster-placeholder[data-thumbhash]')).not.toBeNull();
    expect(host.querySelector('.poster-site')).toBeNull();
    expect(host.querySelector('.poster-mosaic')).toBeNull();
  });
});

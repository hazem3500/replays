// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Poster, PosterPendingContext, resetPosters } from '../src/client/index/Poster.tsx';
import { rgbaToThumbHash, thumbHashToBase64 } from '../src/shared/thumbhash.ts';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetPosters();
  vi.unstubAllGlobals();
});

describe('replay poster loading state', () => {
  it('shows the loading placeholder until the poster image is ready', async () => {
    await act(async () => root.render(createElement(Poster, { id: 'demo', host: 'sample.test' })));
    const poster = host.querySelector<HTMLElement>('.poster')!;

    expect(poster.dataset.phase).toBe('loading');
    expect(poster.querySelector('.poster-placeholder')).not.toBeNull();
    expect(poster.querySelector('img')).not.toBeNull();

    await act(async () => poster.querySelector('img')!.dispatchEvent(new Event('load')));
    expect(poster.dataset.phase).toBe('ready');
    expect(poster.querySelector('.poster-placeholder')).not.toBeNull();
  });

  it('keeps the placeholder and stops loading when the poster is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })));
    await act(async () => root.render(createElement(Poster, { id: 'missing', host: 'sample.test' })));
    const poster = host.querySelector<HTMLElement>('.poster')!;

    await act(async () => poster.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(poster.dataset.phase).toBe('none');
    expect(poster.querySelector('.poster-placeholder')).not.toBeNull();
    expect(poster.querySelector('img')).toBeNull();
  });

  it('draws the summary’s ThumbHash at once, with no breathing, and nothing fake when there is none', async () => {
    const pixels = Array.from({ length: 8 * 5 }, (_, index) => [index * 6, 120, 200 - index * 4, 255]).flat();
    const hash = thumbHashToBase64(rgbaToThumbHash(8, 5, pixels));
    await act(async () =>
      root.render(
        createElement('div', null, [
          createElement(Poster, { key: 'hashed', id: 'a', host: 'shop.example.com', size: 'card', hash }),
          createElement(Poster, { key: 'plain', id: 'b', host: 'shop.example.com', size: 'card' }),
        ]),
      ),
    );
    const [hashed, plain] = [...host.querySelectorAll<HTMLElement>('.poster')];
    expect(hashed!.hasAttribute('data-thumb')).toBe(true);
    expect(hashed!.style.getPropertyValue('--poster-thumb')).toMatch(/^url\("data:image\/png;base64,/);
    expect(plain!.hasAttribute('data-thumb')).toBe(false);
    // The tile is empty: no stand-in page, no letter, no host.
    expect(plain!.querySelector('.poster-placeholder')!.childElementCount).toBe(0);
    expect(plain!.textContent).toBe('');
  });

  it('never fetches inside a pending feed', async () => {
    await act(async () =>
      root.render(createElement(PosterPendingContext, { value: true }, createElement(Poster, { id: 'pending-0', host: 'a.test', playing: true }))),
    );
    const poster = host.querySelector<HTMLElement>('.poster')!;
    expect(poster.querySelector('img')).toBeNull();
    expect(poster.dataset.phase).toBe('none');
  });

  it('stops every waiting poster at once when the server says posters are off', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })));
    await act(async () =>
      root.render(
        createElement('div', null, [
          createElement(Poster, { key: 'a', id: 'a', host: 'a.test' }),
          createElement(Poster, { key: 'b', id: 'b', host: 'b.test' }),
        ]),
      ),
    );
    const [first, second] = [...host.querySelectorAll<HTMLElement>('.poster')];
    expect(second!.dataset.phase).toBe('loading');

    await act(async () => first!.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(first!.dataset.phase).toBe('none');
    // No sheen any more, but its request stays: a poster stored before posters went off is still served.
    expect(second!.dataset.phase).toBe('none');
    expect(second!.querySelector('img')).not.toBeNull();

    await act(async () => second!.querySelector('img')!.dispatchEvent(new Event('load')));
    expect(second!.dataset.phase).toBe('ready');
  });
});

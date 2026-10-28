// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Poster, resetPosters } from '../src/client/index/Poster.tsx';

/** Runs `change` inside act and lets the promise callbacks it starts (the mocked HEAD request) settle. */
const settle = (change: () => void) =>
  act(() => {
    change();
    return Promise.resolve();
  });
const image = (poster: HTMLElement | undefined) => poster?.querySelector('img') ?? undefined;
const fire = (poster: HTMLElement | undefined, type: 'load' | 'error') => settle(() => image(poster)?.dispatchEvent(new Event(type)));

/** A fresh React root per test, unmounted after it with the posters' page-wide state reset. */
function mountPoint() {
  const mount: { host: HTMLDivElement; root?: Root } = { host: document.createElement('div') };
  beforeEach(() => {
    mount.host = document.createElement('div');
    document.body.append(mount.host);
    mount.root = createRoot(mount.host);
  });
  afterEach(async () => {
    await settle(() => mount.root?.unmount());
    mount.host.remove();
    resetPosters();
    vi.unstubAllGlobals();
  });
  return {
    render: (element: ReactElement) => settle(() => mount.root?.render(element)),
    posters: () => [...mount.host.querySelectorAll<HTMLElement>('.poster')],
  };
}

describe('replay poster loading state', () => {
  const { render, posters } = mountPoint();

  it('shows the loading placeholder until the poster image is ready', async () => {
    await render(createElement(Poster, { id: 'demo', host: 'sample.test' }));
    const [poster] = posters();
    expect(poster?.dataset.phase).toBe('loading');
    expect(poster?.querySelector('.poster-placeholder')).not.toBeNull();
    expect(image(poster)).toBeDefined();

    await fire(poster, 'load');
    expect(poster?.dataset.phase).toBe('ready');
    expect(poster?.querySelector('.poster-placeholder')).not.toBeNull();
  });

  it('keeps the placeholder and stops loading when the poster is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })));
    await render(createElement(Poster, { id: 'missing', host: 'sample.test' }));
    const [poster] = posters();

    await fire(poster, 'error');
    expect(poster?.dataset.phase).toBe('none');
    expect(poster?.querySelector('.poster-placeholder')).not.toBeNull();
    expect(image(poster)).toBeUndefined();
  });
});

describe('replay poster placeholder', () => {
  const { render, posters } = mountPoint();

  it('draws nothing made up in the tile while there is no poster', async () => {
    await render(createElement(Poster, { id: 'b', host: 'shop.example.com', size: 'card' }));
    const [plain] = posters();
    expect(plain?.querySelector('.poster-placeholder')?.childElementCount).toBe(0);
    expect(plain?.textContent).toBe('');
  });

  it('stops every waiting poster at once when the server says posters are off, and still shows a stored one', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })));
    await render(
      createElement('div', null, [
        createElement(Poster, { key: 'a', id: 'a', host: 'a.test' }),
        createElement(Poster, { key: 'b', id: 'b', host: 'b.test' }),
      ]),
    );
    const [first, second] = posters();
    expect(second?.dataset.phase).toBe('loading');

    await fire(first, 'error');
    expect(first?.dataset.phase).toBe('none');
    // why: no breathing once posters are off, but the request stays: a poster stored before then is still served.
    expect(second?.dataset.phase).toBe('none');
    expect(image(second)).toBeDefined();

    await fire(second, 'load');
    expect(second?.dataset.phase).toBe('ready');
  });
});

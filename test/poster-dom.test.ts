// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Poster, resetPosters } from '../src/client/index/Poster.tsx';

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
    expect(poster.querySelector('.poster-placeholder')?.textContent).toBe('S');
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
    expect(poster.querySelector('.poster-placeholder')?.textContent).toBe('S');
    expect(poster.querySelector('img')).toBeNull();
  });
});

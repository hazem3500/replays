// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IndexIdentity } from '../src/client/index/IndexHeader.tsx';
import { withBase } from '../src/server/base-path.ts';
import { type BrandingConfig, pageBranding, validateBranding } from '../src/server/branding.ts';
import { FAVICON_MARK, markShapes } from '../src/client/components/brand-mark-geometry.ts';
import { PRODUCT_NAME } from '../src/shared/brand.ts';

const repo = (path: string) => resolve(import.meta.dirname, '..', path);
const indexHtml = readFileSync(repo('index.html'), 'utf8');
const brand = (file: string) => repo(`public/assets/brand/${file}`);

/** index.html's icon links as a server with this branding serves the page, after its brand-icons script ran. */
function servedIcons(branding: Partial<BrandingConfig> = {}) {
  const html = withBase(indexHtml, '', pageBranding(validateBranding(branding)));
  const page = new DOMParser().parseFromString(html, 'text/html');
  const script = page.querySelector('script[data-brand-icons]')?.textContent ?? '';
  new Function('document', script)(page);
  return [...page.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')].map((link) => ({
    rel: link.getAttribute('rel'),
    href: link.getAttribute('href'),
    type: link.getAttribute('type'),
  }));
}

describe('built-in icons', () => {
  it('links the favicon, touch icon and manifest, all of which ship in public/assets/brand', () => {
    const icons = servedIcons();
    expect(icons).toEqual([
      { rel: 'icon', href: '/assets/brand/favicon-32.png', type: 'image/png' },
      { rel: 'icon', href: '/assets/brand/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/assets/brand/apple-touch-icon.png', type: null },
      { rel: 'manifest', href: '/assets/brand/manifest.json', type: null },
    ]);
    expect(icons.filter(({ href }) => !existsSync(repo(`public${href}`)))).toEqual([]);
  });

  it('draws the favicon from the 16 px cut of the mark, in the accent of either scheme', () => {
    const svg = readFileSync(brand('favicon.svg'), 'utf8');
    expect(svg).toContain(markShapes(FAVICON_MARK, { accent: 'currentColor', rest: 'currentColor' }));
    expect(svg).toMatch(/@media \(prefers-color-scheme: dark\)\{svg\{color:#8b9dff\}\}/);
  });

  it('names the product in the manifest and points its icons at files beside it', () => {
    const manifest = JSON.parse(readFileSync(brand('manifest.json'), 'utf8')) as { name: string; icons: Array<{ src: string; purpose: string }> };
    expect(manifest.name).toBe(PRODUCT_NAME);
    expect(manifest.icons.filter((icon) => icon.purpose === 'maskable').map((icon) => icon.src)).toEqual(['icon-192.png', 'icon-512.png']);
    expect(manifest.icons.filter((icon) => !existsSync(brand(icon.src)))).toEqual([]);
    // why: the brand-icons script tells a renamed deployment by comparing with this literal.
    expect(indexHtml).toContain(`var renamed = name !== '${PRODUCT_NAME}'`);
  });
});

describe('branding overrides the built-in icons', () => {
  it('makes a deployment logo the tab icon and drops the built-in touch icon and manifest', () => {
    const logoUrl = 'https://example.com/logo.svg';
    expect(servedIcons({ name: 'Acme Replays', logoUrl })).toEqual([
      { rel: 'icon', href: logoUrl, type: null },
      { rel: 'icon', href: logoUrl, type: null },
    ]);
    const dataLogo = 'data:image/png;base64,iVBORw0KGgo=';
    expect(servedIcons({ logoUrl: dataLogo }).map((icon) => icon.href)).toEqual([dataLogo, dataLogo]);
  });

  it('keeps the built-in mark for a name alone, without the manifest that carries the built-in name', () => {
    expect(servedIcons({ name: 'Acme Replays' }).map((icon) => icon.rel)).toEqual(['icon', 'icon', 'apple-touch-icon']);
  });
});

/** A server-filled `<meta name="app-…">` (src/client/config.ts reads them). */
function meta(name: string, content: string) {
  const element = document.createElement('meta');
  element.name = name;
  element.content = content;
  document.head.append(element);
}

describe('index header identity', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.head.querySelectorAll('meta[name^="app-"]').forEach((element) => element.remove());
    vi.unstubAllGlobals();
  });

  it('shows the built-in mark beside the product name', async () => {
    await act(async () => root.render(createElement(IndexIdentity)));
    const mark = host.querySelector('.mark-button svg.product-mark');
    expect(mark?.querySelectorAll('.mark-seg')).toHaveLength(5);
    expect(mark?.querySelectorAll('.mark-seg[data-on]')).toHaveLength(2);
    expect(mark?.querySelector('.mark-playhead')).not.toBeNull();
    expect(host.querySelector('.index-title')?.textContent).toBe(PRODUCT_NAME);
  });

  it('under reduced motion, fills a segment per click without animating and only crossfades the title on the fifth', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    vi.stubGlobal('scrollTo', () => undefined);
    const animated: Element[] = [];
    const animate = vi.spyOn(Element.prototype, 'animate').mockImplementation(function (this: Element) {
      animated.push(this);
      return { finished: Promise.resolve() } as unknown as Animation;
    });
    try {
      await act(async () => root.render(createElement(IndexIdentity)));
      const button = host.querySelector<HTMLButtonElement>('.mark-button')!;
      const mark = host.querySelector<SVGSVGElement>('svg.product-mark')!;
      await act(async () => button.click());
      expect(mark.dataset.filled).toBe('3');
      expect(mark.querySelectorAll('.mark-seg[data-on]')).toHaveLength(3);
      for (let click = 2; click <= 5; click++) await act(async () => button.click());
      expect(mark.dataset.filled).toBe('5');
      expect(animated).toEqual([host.querySelector('.index-title')]);
      await act(async () => vi.advanceTimersByTime(1600));
      expect(mark.dataset.filled).toBe('2');
      expect(mark.querySelectorAll('.mark-seg[data-on]')).toHaveLength(2);
    } finally {
      animate.mockRestore();
      vi.useRealTimers();
    }
  });

  it('shows the deployment logo and name instead', async () => {
    meta('app-name', 'Acme Replays');
    meta('app-logo', 'https://example.com/logo.svg');
    await act(async () => root.render(createElement(IndexIdentity)));
    expect(host.querySelector('.product-mark')).toBeNull();
    expect(host.querySelector('img.product-logo')?.getAttribute('src')).toBe('https://example.com/logo.svg');
    expect(host.querySelector('.index-title')?.textContent).toBe('Acme Replays');
  });
});

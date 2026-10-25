import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { withBase } from '../src/server/base-path.ts';
import { pageBranding, themeColor, validateBranding } from '../src/server/branding.ts';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const themeSource = readFileSync(new URL('../src/client/theme.tsx', import.meta.url), 'utf8');
const inline = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

/** Runs index.html's inline script against a stub page and returns what it applied before hydration. */
function boot({ saved, prefersLight, page = html }: { saved?: string; prefersLight?: boolean; page?: string }) {
  const tag = /<meta name="theme-color"[^>]*>/.exec(page)?.[0] ?? '';
  const attributes = Object.fromEntries([...tag.matchAll(/ ([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
  const meta = { content: '', getAttribute: (name: string) => attributes[name] ?? null };
  const root = { dataset: {} as Record<string, string> };
  const run = new Function('localStorage', 'matchMedia', 'document', inline);
  run(
    { getItem: (key: string) => (key === 'replays-theme' ? (saved ?? null) : null) },
    (query: string) => ({ matches: query === '(prefers-color-scheme: light)' && Boolean(prefersLight) }),
    { documentElement: root, querySelector: () => meta },
  );
  return { theme: root.dataset.theme, color: meta.content };
}

describe('theme before hydration', () => {
  const colors = Object.fromEntries(
    [...(/THEME_COLORS[^=]*=\s*\{([^}]*)\}/.exec(themeSource)?.[1] ?? '').matchAll(/(\w+):\s*'(#[0-9a-f]{6})'/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );

  it('has an inline script and the same colours as theme.tsx', () => {
    expect(inline).toContain('theme-color');
    expect(colors).toEqual({ dark: expect.any(String), light: expect.any(String) });
  });

  it('applies the saved theme, else the OS preference, and its theme-color', () => {
    expect(boot({ saved: 'light' })).toEqual({ theme: 'light', color: colors.light });
    expect(boot({ saved: 'dark', prefersLight: true })).toEqual({ theme: 'dark', color: colors.dark });
    expect(boot({ prefersLight: true })).toEqual({ theme: 'light', color: colors.light });
    expect(boot({ saved: 'sepia' })).toEqual({ theme: 'dark', color: colors.dark });
  });

  it('ships a static theme-color that matches the default themes', () => {
    expect(html).toContain(`<meta name="theme-color" content="${colors.dark}" data-dark="${colors.dark}" data-light="${colors.light}" />`);
  });

  it('follows the branding page colours once the server stamped them', () => {
    const branded = withBase(
      html,
      '',
      pageBranding(validateBranding({ theme: { dark: { page: '#101820' }, light: { page: '#fafaf5' } } })),
    );
    expect(branded).toContain('<meta name="theme-color" content="#101820" data-dark="#101820" data-light="#fafaf5" />');
    expect(boot({ saved: 'light', page: branded })).toEqual({ theme: 'light', color: '#fafaf5' });
    expect(boot({ saved: 'dark', page: branded })).toEqual({ theme: 'dark', color: '#101820' });
  });

  it('keeps the built-in colour of a scheme the theme leaves alone', () => {
    const branded = withBase(html, '', pageBranding(validateBranding({ theme: { light: { page: '#fafaf5', accent: '#123456' } } })));
    expect(branded).toContain(`<meta name="theme-color" content="${colors.dark}" data-dark="${colors.dark}" data-light="#fafaf5" />`);
    expect(boot({ prefersLight: true, page: branded })).toEqual({ theme: 'light', color: '#fafaf5' });
    // A theme without page colours leaves the meta as shipped.
    const accentOnly = withBase(html, '', pageBranding(validateBranding({ theme: { dark: { accent: '#123456' } } })));
    expect(/<meta name="theme-color"[^>]*>/.exec(accentOnly)?.[0]).toBe(/<meta name="theme-color"[^>]*>/.exec(html)?.[0]);
  });

  it('reads the page token per scheme', () => {
    expect(themeColor(validateBranding({}))).toBeUndefined();
    expect(themeColor(validateBranding({ theme: { dark: { page: '#000' } } }))).toEqual({ dark: '#000' });
  });

  it('escapes what it stamps', () => {
    const out = withBase('<meta name="theme-color" content="#0c0e12" data-dark="#0c0e12" data-light="#eff1f5" />', '', {
      name: 'x',
      tokensCss: '',
      themeColor: { dark: '"><b>' },
    });
    expect(out).not.toContain('<b>');
  });

  it('theme.tsx prefers the stamped colour over its fallback', () => {
    expect(themeSource).toContain('getAttribute(`data-${theme}`) || THEME_COLORS[theme]');
  });
});

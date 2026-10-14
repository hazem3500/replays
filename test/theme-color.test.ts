import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const themeSource = readFileSync(new URL('../src/client/theme.tsx', import.meta.url), 'utf8');
const inline = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

/** Runs index.html's inline script against a stub page and returns what it applied before hydration. */
function boot({ saved, prefersLight }: { saved?: string; prefersLight?: boolean }) {
  const meta = { content: '' };
  const root = { dataset: {} as Record<string, string> };
  const run = new Function('localStorage', 'matchMedia', 'document', inline);
  run(
    { getItem: (key: string) => (key === 'replay-kit-theme' ? (saved ?? null) : null) },
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

  it('ships a static theme-color that matches the default dark theme', () => {
    expect(html).toContain(`<meta name="theme-color" content="${colors.dark}" />`);
  });
});

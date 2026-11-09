import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { withBase } from '../src/server/base-path.ts';
import {
  assertThemeTokens,
  type BrandingConfig,
  pageBranding,
  publicConfig,
  THEME_TOKENS,
  tokensCss,
  validateBranding,
} from '../src/server/branding.ts';
import { PRODUCT_NAME } from '../src/shared/brand.ts';

describe('validateBranding', () => {
  it('defaults to the product name', () => {
    expect(validateBranding(undefined)).toEqual({ name: PRODUCT_NAME });
    expect(validateBranding({})).toEqual({ name: PRODUCT_NAME });
  });

  it('trims the name and bounds it to 1-60 characters', () => {
    expect(validateBranding({ name: '  Acme Replays  ' }).name).toBe('Acme Replays');
    expect(validateBranding({ name: 'x'.repeat(60) }).name).toHaveLength(60);
    expect(() => validateBranding({ name: 'x'.repeat(61) })).toThrow('the product name must be 1-60 characters');
    expect(() => validateBranding({ name: '   ' })).toThrow('the product name must be 1-60 characters');
  });

  it('accepts an https logo or a base64 data image', () => {
    expect(validateBranding({ logoUrl: ' https://example.com/logo.svg ' }).logoUrl).toBe('https://example.com/logo.svg');
    for (const kind of ['png', 'svg+xml', 'webp', 'jpeg'])
      expect(validateBranding({ logoUrl: `data:image/${kind};base64,AAAA` }).logoUrl).toBe(`data:image/${kind};base64,AAAA`);
    expect('logoUrl' in validateBranding({ logoUrl: '  ' })).toBe(false);
  });

  it('refuses any other logo URL', () => {
    for (const bad of [
      'http://example.com/logo.svg',
      '/assets/logo.svg',
      'javascript:alert(1)',
      'data:text/html;base64,AAAA',
      'data:image/svg+xml,<svg/>',
      'data:image/gif;base64,AAAA',
      '//example.com/logo.svg',
      'logo.svg',
    ])
      expect(() => validateBranding({ logoUrl: bad })).toThrow('LOGO_URL must be an https URL or a base64 data: image');
  });

  it('keeps a valid theme and refuses an invalid one', () => {
    const theme = { dark: { accent: '#7aa2ff', radius: '8px' }, light: { accent: 'rgb(47, 85, 212)' } };
    expect(validateBranding({ theme }).theme).toEqual(theme);
    expect(() => validateBranding({ theme: { dark: { accent: 'red; } body { display: none' } } })).toThrow(
      'theme.dark.accent is not a plain CSS value',
    );
    expect(() => validateBranding({ theme: { light: { nope: 'red' } as never } })).toThrow(/^theme\.light\.nope is not a theme token/);
  });
});

describe('theme tokens', () => {
  it('accepts plain colour, length and font values for every token', () => {
    const values = [
      '#fff',
      '#0c0e12',
      'rgb(1, 2, 3)',
      'rgba(1,2,3,.5)',
      'hsl(220 20% 10%)',
      'oklch(0.7 0.1 250)',
      '8px',
      '0.5rem',
      '"Inter", system-ui, sans-serif',
      "'JetBrains Mono', monospace",
    ];
    for (const token of THEME_TOKENS)
      for (const value of values) expect(() => assertThemeTokens({ [token]: value }, 'theme'), `${token}: ${value}`).not.toThrow();
  });

  it('refuses unknown tokens, naming the allowed ones', () => {
    expect(() => assertThemeTokens({ background: '#fff' }, 'theme.dark')).toThrow(
      `theme.dark.background is not a theme token (${THEME_TOKENS.join(', ')})`,
    );
    expect(() => assertThemeTokens({ '--accent': '#fff' }, 'theme')).toThrow(/not a theme token/);
  });

  it('refuses values that could break out of a declaration or load something', () => {
    const unsafe = [
      'red; color: blue',
      'red} body{display:none',
      '{}',
      'url(https://evil.example/x.png)',
      'URL(data:image/png;base64,AAAA)',
      'expression(alert(1))',
      '@import "https://evil.example/x.css"',
      '/* comment */ red',
      'red</style><script>alert(1)</script>',
      '<b>',
      'a\\b',
      'x'.repeat(201),
      '',
    ];
    for (const value of unsafe)
      expect(() => assertThemeTokens({ accent: value }, 'theme')).toThrow('theme.accent is not a plain CSS value');
    for (const value of [1, true, null, ['red'], { a: 1 }])
      expect(() => assertThemeTokens({ accent: value }, 'theme')).toThrow(/is not a plain CSS value/);
  });

  it('requires an object per colour scheme', () => {
    for (const bad of [null, 'red', ['accent'], 3])
      expect(() => assertThemeTokens(bad, 'theme.dark')).toThrow('theme.dark must be an object');
  });
});

describe('tokensCss', () => {
  it('is empty without a theme', () => {
    expect(tokensCss({ name: 'x' })).toBe('');
    expect(tokensCss({ name: 'x', theme: {} })).toBe('');
    expect(tokensCss({ name: 'x', theme: { dark: {} } })).toBe('');
  });

  it('writes dark overrides at :root and light overrides under the light theme selector', () => {
    expect(tokensCss({ name: 'x', theme: { dark: { accent: '#7aa2ff', ring: '#9bb8ff' } } })).toBe(
      ':root{--accent:#7aa2ff;--ring:#9bb8ff}',
    );
    expect(tokensCss({ name: 'x', theme: { light: { accent: '#2f55d4' } } })).toBe(':root[data-theme="light"]{--accent:#2f55d4}');
    expect(tokensCss({ name: 'x', theme: { dark: { radius: '4px' }, light: { radius: '6px', 'text-secondary': '#445' } } })).toBe(
      ':root{--radius:4px}:root[data-theme="light"]{--radius:6px;--text-secondary:#445}',
    );
  });
});

describe('pageBranding and publicConfig', () => {
  const branding: BrandingConfig = validateBranding({
    name: 'Acme Replays',
    logoUrl: 'https://example.com/logo.svg',
    theme: { dark: { accent: '#7aa2ff' } },
  });

  it('hands the page the name, logo and token CSS', () => {
    expect(pageBranding(branding)).toEqual({
      name: 'Acme Replays',
      logoUrl: 'https://example.com/logo.svg',
      tokensCss: ':root{--accent:#7aa2ff}',
    });
    expect(pageBranding({ name: 'Plain' })).toEqual({ name: 'Plain', tokensCss: '' });
  });

  it('tells the client the name, logo, schema, providers and auth mode, and no theme', () => {
    const schema = { type: 'object' };
    expect(publicConfig(branding, { contextSchema: schema, sourceProviders: ['github', 'url'], auth: 'oidc' })).toEqual({
      name: 'Acme Replays',
      logoUrl: 'https://example.com/logo.svg',
      contextSchema: schema,
      sourceProviders: ['github', 'url'],
      auth: 'oidc',
      plugins: [],
      profiles: [],
      purposes: [],
      beta: { editor: false, malleable: false },
    });
    expect(publicConfig({ name: 'Plain' }, { sourceProviders: [], auth: 'none' })).toEqual({
      name: 'Plain',
      sourceProviders: [],
      auth: 'none',
      plugins: [],
      profiles: [],
      purposes: [],
      beta: { editor: false, malleable: false },
    });
  });
});

describe('withBase with branding', () => {
  const INDEX = [
    '<!doctype html><html><head>',
    '<meta name="app-base" content="" />',
    '<meta name="app-name" content="__PRODUCT_NAME__" />',
    '<meta name="app-logo" content="__PRODUCT_LOGO__" />',
    '<title>__PRODUCT_NAME__</title>',
    '<script type="module" src="./assets/main.js"></script>',
    '</head><body></body></html>',
  ].join('');

  it('injects the name into the meta tag and the title, and the logo into its meta tag', () => {
    const html = withBase(INDEX, '', pageBranding(validateBranding({ name: 'Acme Replays', logoUrl: 'https://example.com/logo.svg' })));
    expect(html).toContain('<meta name="app-name" content="Acme Replays" />');
    expect(html).toContain('<meta name="app-logo" content="https://example.com/logo.svg" />');
    expect(html).toContain('<title>Acme Replays</title>');
    expect(html).not.toContain('__PRODUCT');
  });

  it('leaves the logo meta tag empty without a logo', () => {
    expect(withBase(INDEX, '', pageBranding({ name: 'Plain' }))).toContain('<meta name="app-logo" content="" />');
  });

  const FAVICON_INDEX = INDEX.replace('<title>', '<link rel="icon" href="/assets/brand/favicon.svg" type="image/svg+xml" /><title>');
  const iconOf = (html: string) => decodeURIComponent(/<link rel="icon" href="data:image\/svg\+xml,([^"]*)"/.exec(html)?.[1] ?? '');

  it('draws the tab icon in the theme accent, for either scheme', () => {
    const html = withBase(
      FAVICON_INDEX,
      '',
      pageBranding(validateBranding({ theme: { dark: { accent: '#ff5fa2' }, light: { accent: '#c2185b' } } })),
    );
    const svg = iconOf(html);
    expect(svg).toContain('svg{color:#c2185b}@media (prefers-color-scheme:dark){svg{color:#ff5fa2}}');
    const shipped = readFileSync(new URL('../public/assets/brand/favicon.svg', import.meta.url), 'utf8');
    expect(svg).toContain(shipped.split('\n')[2]!);
  });

  it('uses one accent for both schemes when the theme sets one', () => {
    const svg = iconOf(withBase(FAVICON_INDEX, '', pageBranding(validateBranding({ theme: { dark: { accent: '#ff5fa2' } } }))));
    expect(svg).toContain('svg{color:#ff5fa2}@media (prefers-color-scheme:dark){svg{color:#ff5fa2}}');
  });

  it('keeps the built-in tab icon without an accent or with a custom logo', () => {
    expect(withBase(FAVICON_INDEX, '', pageBranding(validateBranding({ name: 'Plain' })))).toContain('href="/assets/brand/favicon.svg"');
    const logo = withBase(
      FAVICON_INDEX,
      '',
      pageBranding(validateBranding({ logoUrl: 'https://example.com/l.svg', theme: { dark: { accent: '#ff5fa2' } } })),
    );
    expect(logo).toContain('href="/assets/brand/favicon.svg"');
  });

  it('adds the brand tokens as a style element at the end of the head, and only when there are some', () => {
    const themed = withBase(
      INDEX,
      '',
      pageBranding(validateBranding({ theme: { dark: { accent: '#7aa2ff' }, light: { accent: '#2f55d4' } } })),
    );
    expect(themed).toContain('<style id="brand-tokens">:root{--accent:#7aa2ff}:root[data-theme="light"]{--accent:#2f55d4}</style></head>');
    expect(withBase(INDEX, '', pageBranding(validateBranding(undefined)))).not.toContain('brand-tokens');
  });

  it('escapes HTML in the name and the logo', () => {
    const html = withBase(INDEX, '', {
      name: '</title><script>alert("x")</script> & Co',
      logoUrl: 'https://example.com/a.svg?x="1"&y=<2>',
      tokensCss: '',
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('<title>&lt;/title&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Co</title>');
    expect(html).toContain('content="https://example.com/a.svg?x=&quot;1&quot;&amp;y=&lt;2&gt;"');
  });

  it('combines with the base path', () => {
    const html = withBase(INDEX, '/replays', pageBranding(validateBranding({ name: 'Acme', theme: { dark: { ring: '#fff' } } })));
    expect(html).toContain('<meta name="app-base" content="/replays" />');
    expect(html).toContain('src="/replays/assets/main.js"');
    expect(html).toContain('<style id="brand-tokens">:root{--ring:#fff}</style>');
  });
});

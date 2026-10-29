import { describe, expect, it } from 'vitest';
import { definePlugin, resolvePlugins } from '../src/plugin/index.ts';
import { pageBranding, validateBranding } from '../src/server/branding.ts';
import { withBase } from '../src/server/base-path.ts';

const themed = (value: string) =>
  definePlugin({
    name: 'theme-host',
    setup(api) {
      api.branding({ theme: { dark: { 'caption-bg': value, 'caption-fg': '#ffffff', 'card-radius': '16px' } } });
    },
  });

describe('plugin theme tokens', () => {
  it('places component tokens in the server-rendered page before hydration', async () => {
    const registry = await resolvePlugins([themed('#1a0b00')]);
    const html = withBase('<html><head></head><body></body></html>', '', pageBranding(validateBranding(registry.branding)));
    expect(html).toContain('<style id="brand-tokens">:root{--caption-bg:#1a0b00;--caption-fg:#ffffff;--card-radius:16px}</style>');
  });

  it('rejects external resource loads in newly published tokens', async () => {
    await expect(resolvePlugins([themed('url(https://example.com/pixel)')])).rejects.toThrow('not a plain CSS value');
  });
});

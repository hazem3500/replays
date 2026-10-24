import type { BrandingConfig } from '@hazem3500/replays/server';

export const theme = {
  dark: {
    page: '#19131f',
    surface: '#241b2c',
    accent: '#ed9cc9',
    'accent-contrast': '#291528',
    ring: '#ed9cc9',
    radius: '10px',
  },
  light: {
    page: '#faf6f9',
    surface: '#ffffff',
    accent: '#853764',
    'accent-contrast': '#ffffff',
    ring: '#853764',
    radius: '10px',
  },
} satisfies NonNullable<BrandingConfig['theme']>;

export const logoUrl = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#853764"/><path fill="#fff" d="m9 6 10 6-10 6z"/></svg>',
).toString('base64')}`;

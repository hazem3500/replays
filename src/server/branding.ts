import { PRODUCT_NAME } from '../shared/brand.ts';
import type { PageBranding } from './base-path.ts';

/**
 * Theming without a rebuild. Every colour in the viewer is a CSS custom property (src/client/styles.css); a
 * deployment may override the ones listed here, per colour scheme, plus the UI font stack.
 */
export const THEME_TOKENS = [
  'accent',
  'accent-soft',
  'accent-contrast',
  'page',
  'surface',
  'surface-raised',
  'surface-hover',
  'surface-pressed',
  'canvas',
  'text',
  'text-secondary',
  'text-tertiary',
  'line',
  'line-strong',
  'danger',
  'danger-soft',
  'warning',
  'success',
  'ring',
  'sans',
  'mono',
  'radius',
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];
export type ThemeTokens = Partial<Record<ThemeToken, string>>;

export interface BrandingConfig {
  /** Shown in the header, the page title and the shortcut sheet. */
  name: string;
  /** An absolute path under this app (`/assets/logo.svg` is not served; use an https URL or a data: image) or https URL. */
  logoUrl?: string;
  theme?: { dark?: ThemeTokens; light?: ThemeTokens };
}

/** Token values are plain CSS values: no braces, semicolons, comments, url() or expression(). */
const SAFE_VALUE = /^[#%(),.\w\s"'/-]{1,200}$/;

export function assertThemeTokens(tokens: unknown, name: string): asserts tokens is ThemeTokens {
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) throw new Error(`${name} must be an object`);
  for (const [key, value] of Object.entries(tokens)) {
    if (!(THEME_TOKENS as readonly string[]).includes(key))
      throw new Error(`${name}.${key} is not a theme token (${THEME_TOKENS.join(', ')})`);
    if (typeof value !== 'string' || !SAFE_VALUE.test(value) || /url\(|expression\(|@import|\/\*/i.test(value))
      throw new Error(`${name}.${key} is not a plain CSS value`);
  }
}

export function validateBranding(input: Partial<BrandingConfig> | undefined): BrandingConfig {
  const name = (input?.name ?? PRODUCT_NAME).trim();
  if (!name || name.length > 60) throw new Error('the product name must be 1-60 characters');
  const logoUrl = input?.logoUrl?.trim();
  if (logoUrl && !/^(https:\/\/|data:image\/(png|svg\+xml|webp|jpeg);base64,)/i.test(logoUrl))
    throw new Error('LOGO_URL must be an https URL or a base64 data: image');
  if (input?.theme) {
    for (const scheme of ['dark', 'light'] as const) if (input.theme[scheme]) assertThemeTokens(input.theme[scheme], `theme.${scheme}`);
  }
  return { name, ...(logoUrl ? { logoUrl } : {}), ...(input?.theme ? { theme: input.theme } : {}) };
}

function block(selector: string, tokens: ThemeTokens | undefined) {
  const declarations = Object.entries(tokens ?? {}).map(([key, value]) => `--${key}:${value}`);
  return declarations.length ? `${selector}{${declarations.join(';')}}` : '';
}

/** The `<style>` body that applies the theme overrides (dark is the default scheme at `:root`). */
export function tokensCss(branding: BrandingConfig) {
  return [block(':root', branding.theme?.dark), block(':root[data-theme="light"]', branding.theme?.light)].filter(Boolean).join('');
}

/** The browser chrome colour per scheme: the theme's `page` token where it sets one (index.html keeps the default otherwise). */
export function themeColor(branding: BrandingConfig): { dark?: string; light?: string } | undefined {
  const dark = branding.theme?.dark?.page;
  const light = branding.theme?.light?.page;
  return dark || light ? { ...(dark ? { dark } : {}), ...(light ? { light } : {}) } : undefined;
}

export function pageBranding(branding: BrandingConfig): PageBranding {
  const color = themeColor(branding);
  return {
    name: branding.name,
    tokensCss: tokensCss(branding),
    ...(branding.logoUrl ? { logoUrl: branding.logoUrl } : {}),
    ...(color ? { themeColor: color } : {}),
  };
}

/** What `GET /api/config` tells the client. */
export function publicConfig(
  branding: BrandingConfig,
  extra: {
    contextSchema?: unknown;
    sourceProviders: string[];
    auth: string;
    plugins?: string[];
    beta?: { editor: boolean; malleable?: boolean };
    comments?: boolean;
  },
) {
  return {
    name: branding.name,
    ...(branding.logoUrl ? { logoUrl: branding.logoUrl } : {}),
    ...(extra.contextSchema ? { contextSchema: extra.contextSchema } : {}),
    sourceProviders: extra.sourceProviders,
    auth: extra.auth,
    plugins: extra.plugins ?? [],
    beta: extra.beta ?? { editor: false, malleable: false },
    ...(extra.comments === undefined ? {} : { comments: extra.comments }),
  };
}

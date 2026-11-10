import { PRODUCT_NAME } from '../shared/brand.ts';
import type { HostVersions, MalleablePolicy } from '../shared/malleable-policy.ts';
import type { PageBranding } from './base-path.ts';
import type { ProfileInfo } from '../shared/profiles.ts';
import type { ViewInfo } from '../shared/views.ts';

import { THEME_TOKENS, type ThemeTokens } from '../shared/theme-tokens.ts';

export { THEME_TOKENS, type ThemeToken, type ThemeTokens } from '../shared/theme-tokens.ts';

export interface BrandingConfig {
  /** Shown in the header, the page title and the shortcut sheet. */
  name: string;
  /** An absolute path under this app (`/assets/logo.svg` is not served; use an https URL or a data: image) or https URL. */
  logoUrl?: string;
  theme?: { dark?: ThemeTokens; light?: ThemeTokens };
  /** Links out of the viewer to the deployment's other tools. */
  integrations?: IntegrationsConfig;
  /** Commands the Settings CLI section shows in place of the from-source defaults (a host that publishes its own CLI). */
  cli?: CliConfig;
  /** Where the viewer's help links point; `false` hides a link. A link left unset keeps this project's own docs. */
  links?: LinksConfig;
}

/** One line each, shown in a copy field. Setting `connect` replaces the connect and sign-in steps with that one command. */
export interface CliConfig {
  install?: string;
  installHint?: string;
  connect?: string;
  connectHint?: string;
  upload?: string;
  uploadHint?: string;
}

export const LINK_KEYS = ['source', 'cliGuide', 'authGuide', 'labs', 'docs', 'issues', 'recorderGuide'] as const;
export type LinkKey = (typeof LINK_KEYS)[number];
export type LinksConfig = Partial<Record<LinkKey, string | false>>;

const CLI_KEYS = ['install', 'installHint', 'connect', 'connectHint', 'upload', 'uploadHint'] as const;
type CliKey = (typeof CLI_KEYS)[number];

const isCliKey = (key: string): key is CliKey => CLI_KEYS.some((known) => known === key);
const isLinkKey = (key: string): key is LinkKey => LINK_KEYS.some((known) => known === key);

function validateCli(input: unknown): CliConfig | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('cli must be an object');
  const out: CliConfig = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isCliKey(key)) throw new Error(`cli.${key} is not a CLI setting (${CLI_KEYS.join(', ')})`);
    if (value === undefined) continue;
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || text.length > 300 || /[\r\n]/.test(text)) throw new Error(`cli.${key} must be one line of 1-300 characters`);
    out[key] = text;
  }
  return Object.keys(out).length ? out : undefined;
}

function linkValue(key: string, value: unknown): string | false {
  if (value === false) return false;
  const url = typeof value === 'string' ? value.trim() : '';
  if (!/^https:\/\/\S+$/i.test(url)) throw new Error(`links.${key} must be an https URL or false`);
  return url;
}

function validateLinks(input: unknown): LinksConfig | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('links must be an object');
  const out: LinksConfig = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isLinkKey(key)) throw new Error(`links.${key} is not a link (${LINK_KEYS.join(', ')})`);
    if (value === undefined) continue;
    out[key] = linkValue(key, value);
  }
  return Object.keys(out).length ? out : undefined;
}

export interface IntegrationsConfig {
  /** An https URL with `{traceId}` where the backend trace ID goes (a Grafana Tempo explore link); turns the trace ID in request details into a link. */
  traceUrlTemplate?: string;
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
  const traceUrlTemplate = input?.integrations?.traceUrlTemplate?.trim();
  if (traceUrlTemplate && (!/^https:\/\//i.test(traceUrlTemplate) || !traceUrlTemplate.includes('{traceId}')))
    throw new Error('TRACE_URL_TEMPLATE must be an https URL containing {traceId}');
  const cli = validateCli(input?.cli);
  const links = validateLinks(input?.links);
  return {
    name,
    ...(cli ? { cli } : {}),
    ...(links ? { links } : {}),
    ...(logoUrl ? { logoUrl } : {}),
    ...(input?.theme ? { theme: input.theme } : {}),
    ...(traceUrlTemplate ? { integrations: { traceUrlTemplate } } : {}),
  };
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

/** The theme's `accent` per scheme, where it sets one. */
export function themeAccent(branding: BrandingConfig): { dark?: string; light?: string } | undefined {
  const dark = branding.theme?.dark?.accent;
  const light = branding.theme?.light?.accent;
  return dark || light ? { ...(dark ? { dark } : {}), ...(light ? { light } : {}) } : undefined;
}

export function pageBranding(branding: BrandingConfig): PageBranding {
  const color = themeColor(branding);
  const accent = themeAccent(branding);
  return {
    name: branding.name,
    tokensCss: tokensCss(branding),
    ...(branding.logoUrl ? { logoUrl: branding.logoUrl } : {}),
    ...(color ? { themeColor: color } : {}),
    ...(accent ? { accent } : {}),
  };
}

/** What `GET /api/config` tells the client. */
export function publicConfig(
  branding: BrandingConfig,
  extra: {
    contextSchema?: unknown;
    sourceProviders: string[];
    auth: string;
    cliDeviceAuth?: import('./auth/types.ts').CliDeviceAuthCapability;
    signIn?: import('../shared/sign-in.ts').SignInConfig;
    plugins?: string[];
    /** The deployment's profiles (src/shared/profiles.ts); an empty list in a plain core. */
    profiles?: readonly ProfileInfo[];
    /** The deployment's views (src/shared/views.ts). */
    views?: readonly ViewInfo[];
    /** Plugin index filters (`api.indexFilter`): which `x-*` params `GET /api/replays` understands. */
    indexFilters?: Array<{ plugin: string; id: string; param: string }>;
    beta?: { editor: boolean; cursorCustomization?: boolean; malleable?: boolean };
    comments?: boolean;
    editing?: { enabled: boolean };
    versions?: HostVersions;
    malleable?: MalleablePolicy;
  },
) {
  return {
    name: branding.name,
    ...(branding.logoUrl ? { logoUrl: branding.logoUrl } : {}),
    ...(branding.integrations ? { integrations: branding.integrations } : {}),
    ...(branding.cli ? { cli: branding.cli } : {}),
    ...(branding.links ? { links: branding.links } : {}),
    ...(extra.contextSchema ? { contextSchema: extra.contextSchema } : {}),
    sourceProviders: extra.sourceProviders,
    auth: extra.auth,
    ...(extra.cliDeviceAuth ? { cliDeviceAuth: extra.cliDeviceAuth } : {}),
    ...(extra.signIn ? { signIn: extra.signIn } : {}),
    plugins: extra.plugins ?? [],
    profiles: extra.profiles ?? [],
    // why: deprecated alias of `profiles`, kept for API clients written before the rename.
    purposes: extra.profiles ?? [],
    ...(extra.views ? { views: extra.views } : {}),
    ...(extra.indexFilters ? { indexFilters: extra.indexFilters } : {}),
    beta: extra.beta ?? { editor: false, malleable: false },
    ...(extra.editing ? { editing: extra.editing } : {}),
    ...(extra.comments === undefined ? {} : { comments: extra.comments }),
    ...(extra.versions ? { core: extra.versions.core } : {}),
    ...(extra.versions?.distribution ? { distribution: extra.versions.distribution } : {}),
    ...(extra.malleable ? { malleable: extra.malleable } : {}),
  };
}

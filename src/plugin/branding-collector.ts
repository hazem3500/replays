import { assertThemeTokens } from '../server/branding.ts';
import { PluginError } from './errors.ts';
import { errorMessage, type Fail } from './registration-checks.ts';
import type { BrandingContribution } from './types.ts';

const SCHEMES = ['dark', 'light'] as const;

/** Values set by several plugins: the same value twice is fine, a different one is a conflict naming both owners. */
class OwnedValues {
  readonly values: Record<string, string> = {};
  private readonly owners = new Map<string, string>();

  set(key: string, value: string, plugin: string, label: string): void {
    const previous = this.values[key];
    if (previous !== undefined && previous !== value)
      throw new PluginError(
        'conflict',
        `sets ${label} to ${JSON.stringify(value)}, but ${this.owners.get(key) ?? 'another plugin'} already set ${JSON.stringify(previous)}`,
        { plugin },
      );
    this.values[key] = value;
    this.owners.set(key, plugin);
  }
}

/** Every plugin's `api.branding`, merged field by field. */
export class BrandingCollector {
  private readonly scalars = new OwnedValues();
  private readonly theme = { dark: new OwnedValues(), light: new OwnedValues() };

  add(contribution: BrandingContribution, plugin: string, fail: Fail): void {
    if (!contribution || typeof contribution !== 'object') fail('branding needs an object');
    for (const key of ['name', 'logoUrl'] as const) {
      const value = contribution[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || !value.trim()) fail(`branding.${key} must be a non-empty string`);
      this.scalars.set(key, value.trim(), plugin, `branding.${key}`);
    }
    for (const scheme of SCHEMES) {
      const tokens: unknown = contribution.theme?.[scheme];
      if (!tokens) continue;
      try {
        assertThemeTokens(tokens, `branding.theme.${scheme}`);
      } catch (error) {
        fail(errorMessage(error));
      }
      for (const [token, value] of Object.entries(tokens)) this.theme[scheme].set(token, value, plugin, `theme.${scheme}.${token}`);
    }
  }

  result(): BrandingContribution {
    const branding: BrandingContribution = { ...this.scalars.values };
    const theme: NonNullable<BrandingContribution['theme']> = {};
    for (const scheme of SCHEMES) {
      const tokens = this.theme[scheme].values;
      if (!Object.keys(tokens).length) continue;
      assertThemeTokens(tokens, `branding.theme.${scheme}`);
      theme[scheme] = tokens;
    }
    if (theme.dark || theme.light) branding.theme = theme;
    return branding;
  }
}

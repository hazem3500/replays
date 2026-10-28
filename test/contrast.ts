import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type Theme = 'dark' | 'light';

function block(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

function declarations(source: string) {
  const tokens: Record<string, string> = {};
  for (const match of source.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) tokens[match[1]!] = match[2]!.trim();
  return tokens;
}

/** Follows var() references and keeps the tokens that resolve to a hex colour. */
function resolveAll(tokens: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens)) {
    let current = value;
    for (let depth = 0; depth < 5; depth += 1) {
      const reference = /^var\((--[a-z0-9-]+)\)$/.exec(current);
      if (!reference) break;
      current = tokens[reference[1]!] ?? current;
    }
    if (/^#[0-9a-f]{6}$/i.test(current)) out[name] = current.toLowerCase();
  }
  return out;
}

/** Resolved hex colours for each theme, read from the shipped stylesheet. */
export function themeTokens(): Record<Theme, Record<string, string>> {
  const css = readFileSync(resolve(import.meta.dirname, '../src/client/styles.css'), 'utf8');
  const dark = declarations(block(css, ':root'));
  const light = { ...dark, ...declarations(block(css, ':root[data-theme="light"]')) };
  return { dark: resolveAll(dark), light: resolveAll(light) };
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

/** Text token on background token pairs that the UI actually renders. */
export const TEXT_PAIRS: Array<[string, string]> = [
  ['--danger-solid-foreground', '--danger-solid'],
  ['--danger-solid-foreground', '--danger-solid-hover'],
  ['--danger-solid-foreground', '--danger-solid-pressed'],
  ...['--text', '--text-secondary', '--text-tertiary'].flatMap((text) =>
    ['--page', '--surface', '--surface-raised', '--surface-hover', '--accent-soft'].map((background): [string, string] => [
      text,
      background,
    ]),
  ),
  // Pressed rows and buttons carry title and secondary text (meta never sits on the pressed step).
  ['--text', '--surface-pressed'],
  ['--text-secondary', '--surface-pressed'],
  ['--accent', '--surface'],
  ['--accent', '--surface-raised'],
  ['--accent-contrast', '--accent'],
  ['--danger', '--surface'],
  ['--danger', '--surface-raised'],
  ['--danger', '--danger-soft'],
  ['--text-secondary', '--danger-soft'],
  // Failed console/network rows: faint tint, red level/status, normal message text, tertiary time.
  ['--danger', '--danger-tint'],
  ['--text', '--danger-tint'],
  ['--text-secondary', '--danger-tint'],
  ['--text-tertiary', '--danger-tint'],
  ['--warning', '--surface'],
  ['--success', '--surface'],
  ['--page', '--text'],
];

/** sRGB hex to OKLCH lightness (0..1), for the elevation-ramp checks. */
export function oklchLightness(hex: string) {
  const [r, g, b] = [1, 3, 5]
    .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

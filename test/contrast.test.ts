import { describe, expect, it } from 'vitest';

import { contrast, oklchLightness, TEXT_PAIRS, themeTokens } from './contrast.ts';

const themes = themeTokens();

describe.each(['dark', 'light'] as const)('%s theme contrast', (theme) => {
  const tokens = themes[theme];
  it.each(TEXT_PAIRS)('%s on %s is at least 4.5:1', (text, background) => {
    const ratio = contrast(tokens[text]!, tokens[background]!);
    expect(ratio, `${text} ${tokens[text]} on ${background} ${tokens[background]}`).toBeGreaterThanOrEqual(4.5);
  });

  it('red (failure) stays at least 40° of hue away from the accent', () => {
    const distance = Math.abs(hue(tokens['--danger']!) - hue(tokens['--accent']!));
    expect(Math.min(distance, 360 - distance)).toBeGreaterThanOrEqual(40);
  });

  it('the source line (secondary) reads visibly brighter than the meta line (tertiary) on page and raised surfaces', () => {
    for (const background of ['--surface', '--surface-raised']) {
      const secondary = contrast(tokens['--text-secondary']!, tokens[background]!);
      const tertiary = contrast(tokens['--text-tertiary']!, tokens[background]!);
      expect(secondary / tertiary, `secondary vs tertiary on ${background}`).toBeGreaterThanOrEqual(1.5);
    }
    expect(contrast(tokens['--text-secondary']!, tokens['--text-tertiary']!)).toBeGreaterThanOrEqual(1.5);
  });

  it('section headings (secondary, 13 px) and titles clear 7:1 on the page', () => {
    expect(contrast(tokens['--text']!, tokens['--surface']!)).toBeGreaterThanOrEqual(7);
    expect(contrast(tokens['--text-secondary']!, tokens['--surface']!)).toBeGreaterThanOrEqual(7);
  });

  it('the destructive button fill stands out (3:1) on the raised surface dialogs use', () => {
    expect(contrast(tokens['--danger-solid']!, tokens['--surface-raised']!)).toBeGreaterThanOrEqual(3);
  });

  it('keyboard ring is at least 3:1 against the page', () => {
    expect(contrast(tokens['--ring']!, tokens['--page']!)).toBeGreaterThanOrEqual(3);
  });
});

describe('elevation ramp', () => {
  const steps = ['--surface', '--surface-raised', '--surface-hover', '--surface-pressed'];

  it('dark: each step is perceptibly lighter, about 3 to 4 OKLCH L apart', () => {
    const lightness = steps.map((step) => oklchLightness(themes.dark[step]!));
    for (let index = 1; index < lightness.length; index += 1) {
      const delta = (lightness[index]! - lightness[index - 1]!) * 100;
      expect(delta, `${steps[index - 1]} -> ${steps[index]}`).toBeGreaterThanOrEqual(3);
      expect(delta, `${steps[index - 1]} -> ${steps[index]}`).toBeLessThanOrEqual(4.5);
    }
  });

  it('light: raised surfaces are white on a tinted off-white page; hover and pressed step down', () => {
    const light = themes.light;
    expect(light['--surface-raised']).toBe('#ffffff');
    expect(light['--surface']).not.toBe('#ffffff');
    const [page, hover, pressed] = ['--surface', '--surface-hover', '--surface-pressed'].map((step) => oklchLightness(light[step]!)) as [
      number,
      number,
      number,
    ];
    expect(page).toBeGreaterThan(hover);
    expect(hover).toBeGreaterThan(pressed);
  });
});

function hue(hex: string) {
  const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const raw = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (raw * 60 + 360) % 360;
}

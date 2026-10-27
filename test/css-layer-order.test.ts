import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The app's hand-written CSS sits in the `app` cascade layer, above Tailwind's `theme` and `base`. The bundle's
 * CSS follows import order, so a component stylesheet with an `@layer app` block that loads before tailwind.css
 * would make `app` the lowest layer: Tailwind's theme layer (`--ease-out: var(--ease-out)`) then wins and the
 * app's easing and radius tokens resolve to nothing, silently dropping every transition that uses them.
 */
const CLIENT = join(import.meta.dirname, '../src/client');
const ORDER = '@layer properties, theme, base, app, components, utilities;';

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return cssFiles(join(dir, entry.name));
    return entry.name.endsWith('.css') ? [join(dir, entry.name)] : [];
  });
}

const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('cascade-layer order', () => {
  it('main.tsx imports tailwind.css before anything else', () => {
    const imports = [...readFileSync(join(CLIENT, 'main.tsx'), 'utf8').matchAll(/^import .*$/gm)].map((match) => match[0]);
    expect(imports[0]).toBe("import './tailwind.css';");
  });

  it('tailwind.css declares the layers in the documented order', () => {
    const css = withoutComments(readFileSync(join(CLIENT, 'tailwind.css'), 'utf8'));
    expect(css).toContain('@layer theme, base, app, components, utilities;');
  });

  it.each(
    cssFiles(CLIENT)
      .filter((file) => !file.endsWith('tailwind.css') && /@layer app\b/.test(withoutComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(CLIENT, file)),
  )('%s states the full layer order before its first @layer app block', (file) => {
    const css = withoutComments(readFileSync(join(CLIENT, file), 'utf8'));
    const firstLayer = css.indexOf('@layer');
    expect(css.slice(firstLayer, firstLayer + ORDER.length)).toBe(ORDER);
  });
});

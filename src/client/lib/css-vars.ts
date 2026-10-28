import type { CSSProperties } from 'react';

/** Inline style with CSS custom properties, typed without an assertion. */
export function cssVars(vars: Record<`--${string}`, string | number>, base: CSSProperties = {}): CSSProperties {
  return Object.assign({}, base, vars);
}

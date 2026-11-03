const formatter = new Intl.NumberFormat(undefined, { useGrouping: false });

export interface NumberGlyph {
  readonly key: string;
  readonly text: string;
  readonly digit: boolean;
}

/** Native Intl text is the source of truth for rounding, locale, signs and decimal separators. */
export function numberText(value: number): string {
  return formatter.format(value);
}

/** Integer places align from the right so carrying between digits does not shuffle their identity. */
export function numberGlyphs(value: number): readonly NumberGlyph[] {
  const parts = formatter.formatToParts(value);
  let integer = parts.filter((part) => part.type === 'integer').reduce((sum, part) => sum + [...part.value].length, 0);
  let fraction = 0;
  return parts.flatMap((part, index) =>
    [...part.value].map((text, character): NumberGlyph => {
      if (part.type === 'integer') return { key: `integer:${--integer}`, text, digit: true };
      if (part.type === 'fraction') return { key: `fraction:${fraction++}`, text, digit: true };
      return { key: `${part.type}:${index}:${character}`, text, digit: false };
    }),
  );
}

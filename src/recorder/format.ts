export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatDurationLong(ms: number, locale = 'en'): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return [
    [Math.floor(seconds / 3600), 'hour'],
    [Math.floor(seconds / 60) % 60, 'minute'],
    [seconds % 60, 'second'],
  ]
    .filter(([value]) => Boolean(value) || seconds === 0)
    .map(([value, unit]) => new Intl.NumberFormat(locale, { style: 'unit', unit: String(unit), unitDisplay: 'long' }).format(Number(value)))
    .filter((_, index) => seconds > 0 || index === 2)
    .join(' ');
}

/** How the recorder UI turns numbers into text. Each hook receives raw values. */
export type RecorderFormat = {
  /** The running indicator clock. Default `m:ss` digits in `locale`. */
  elapsed: (ms: number) => string;
  /** A length in words, for review and consent copy. Default `formatDurationLong`. */
  duration: (ms: number) => string;
  /** An approximate byte size. Default Intl `byte`…`gigabyte` units, base 1000. */
  bytes: (bytes: number) => string;
};

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;

/** Intl-based defaults in `locale` (default `en`), with any `overrides` applied. */
export function createRecorderFormat(locale = 'en', overrides: Partial<RecorderFormat> = {}): RecorderFormat {
  const digits = (value: number, minimumIntegerDigits = 1) =>
    new Intl.NumberFormat(locale, { minimumIntegerDigits, useGrouping: false }).format(value);
  return {
    elapsed: (ms) => {
      const seconds = Math.max(0, Math.round(ms / 1000));
      return `${digits(Math.floor(seconds / 60))}:${digits(seconds % 60, 2)}`;
    },
    duration: (ms) => formatDurationLong(ms, locale),
    bytes: (bytes) => {
      let value = Math.max(0, bytes);
      let unit = 0;
      while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
        value /= 1000;
        unit++;
      }
      return new Intl.NumberFormat(locale, { style: 'unit', unit: BYTE_UNITS[unit], maximumFractionDigits: unit ? 1 : 0 }).format(value);
    },
    ...overrides,
  };
}

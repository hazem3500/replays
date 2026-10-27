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

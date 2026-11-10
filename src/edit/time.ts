import { usageError } from './errors.ts';

const SECONDS = /^(\d+(?:\.\d+)?)s$/;
const MILLISECONDS = /^(\d+(?:\.\d+)?)ms$/;
const CLOCK_MINUTES = /^(\d+):([0-5]?\d(?:\.\d+)?)$/;
const CLOCK_HOURS = /^(\d+):([0-5]?\d):([0-5]?\d(?:\.\d+)?)$/;
const COMPOUND = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/;

/**
 * A time on the original replay timeline, in whole ms: `12.3s`, `1500ms`, `1:02.5`, `1:02:03`, `1m30s`, `start`, or `end`
 * (the replay's length, when `end` is given). A bare number is refused because it could be seconds or ms.
 */
export function parseTime(input: string, end?: number): number {
  const text = input.trim().toLowerCase();
  if (text === 'start') return 0;
  if (text === 'end') {
    if (end === undefined) throw usageError('"end" needs the replay length, which is not known here');
    return end;
  }
  const ms = MILLISECONDS.exec(text);
  if (ms) return Math.round(Number(ms[1]));
  const seconds = SECONDS.exec(text);
  if (seconds) return Math.round(Number(seconds[1]) * 1000);
  const minutes = CLOCK_MINUTES.exec(text);
  if (minutes) return Math.round((Number(minutes[1]) * 60 + Number(minutes[2])) * 1000);
  const hours = CLOCK_HOURS.exec(text);
  if (hours) return Math.round((Number(hours[1]) * 3600 + Number(hours[2]) * 60 + Number(hours[3])) * 1000);
  const compound = COMPOUND.exec(text);
  if (text && compound)
    return Math.round((Number(compound[1] ?? 0) * 3600 + Number(compound[2] ?? 0) * 60 + Number(compound[3] ?? 0)) * 1000);
  throw usageError(`"${input}" is not a time; write 12.3s, 1:02.5, 1500ms, start or end`);
}

/** `10.0s` under a minute, `1:02.5` from there; what `parseTime` reads back. */
export function formatTime(ms: number): string {
  const tenths = Math.round(ms / 100);
  if (tenths < 600) return `${(tenths / 10).toFixed(1)}s`;
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths - minutes * 600) / 10;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

export const formatRange = (from: number, to: number) => `${formatTime(from)}–${formatTime(to)}`;

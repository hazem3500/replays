import type { ConsoleLevel, ReplayConsoleEntry } from '../../../shared/replay.ts';

/**
 * One row of the console list: an entry, or a run of identical consecutive entries (same level and text) folded into
 * one with a count. `ats` keeps every time so the detail can seek to each.
 */
export interface ConsoleRow {
  id: string;
  entry: ReplayConsoleEntry;
  at: number;
  ats: number[];
  count: number;
  /** Lines in the message as captured (a thrown error's stack, a multi-line log). */
  lines: number;
}

/** Folds runs of identical consecutive entries, in time order. */
export function groupRepeats(entries: readonly ReplayConsoleEntry[]): ConsoleRow[] {
  const rows: ConsoleRow[] = [];
  for (const [index, entry] of entries.entries()) {
    const last = rows.at(-1);
    if (last && last.entry.level === entry.level && last.entry.message === entry.message) {
      last.ats.push(entry.at);
      last.count += 1;
      continue;
    }
    rows.push({ id: `console-${index}`, entry, at: entry.at, ats: [entry.at], count: 1, lines: entry.message.split('\n').length });
  }
  return rows;
}

/** The word for each captured level, everywhere the panel names one. */
export const LEVEL_NAMES: Readonly<Record<ConsoleLevel, string>> = {
  error: 'Error',
  warn: 'Warning',
  info: 'Info',
  log: 'Log',
  debug: 'Debug',
};

export type LevelFilter = 'all' | 'error' | 'warn' | 'info' | 'debug';

/** `info` covers `log` too: the capture keeps both, and people read them as one "ordinary output" level. */
const LEVEL_TESTS: Readonly<Record<LevelFilter, (level: ConsoleLevel) => boolean>> = {
  all: () => true,
  error: (level) => level === 'error',
  warn: (level) => level === 'warn',
  info: (level) => level === 'info' || level === 'log',
  debug: (level) => level === 'debug',
};

/** Entries (not rows) per level filter, so a folded run counts every time it was logged. */
export function levelCounts(rows: readonly ConsoleRow[]): Record<LevelFilter, number> {
  const count = (filter: LevelFilter) => rows.reduce((sum, row) => sum + (LEVEL_TESTS[filter](row.entry.level) ? row.count : 0), 0);
  return { all: count('all'), error: count('error'), warn: count('warn'), info: count('info'), debug: count('debug') };
}

export function filterRows(rows: readonly ConsoleRow[], level: LevelFilter, text: string) {
  const words = text.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (!LEVEL_TESTS[level](row.entry.level)) return false;
    const haystack = `${row.entry.message} ${row.entry.url ?? ''}`.toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export type MessagePart = { kind: 'text'; text: string } | { kind: 'json'; text: string };

/** Where the balanced `{…}` or `[…]` starting at `start` ends (exclusive), skipping brackets inside strings. */
function balancedEnd(text: string, start: number) {
  let depth = 0;
  let quoted = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '\\') index++;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') {
      depth--;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function parsedJson(text: string): string | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : undefined;
  } catch {
    // why: brackets in prose ("[1/3] retrying") are not JSON; they stay text.
    return;
  }
}

/**
 * A message as the detail shows it. The capture joins a log call's arguments with spaces and writes objects as compact
 * JSON, so JSON objects and arrays found in the text are indented; everything else stays exactly as captured.
 */
export function messageParts(message: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let cursor = 0;
  let search = 0;
  while (search < message.length) {
    const start = message.slice(search).search(/[[{]/);
    if (start < 0) break;
    const open = search + start;
    const end = balancedEnd(message, open);
    const json = end > 0 ? parsedJson(message.slice(open, end)) : undefined;
    if (json === undefined) {
      search = open + 1;
      continue;
    }
    if (open > cursor) parts.push({ kind: 'text', text: message.slice(cursor, open) });
    parts.push({ kind: 'json', text: json });
    cursor = end;
    search = end;
  }
  if (cursor < message.length) parts.push({ kind: 'text', text: message.slice(cursor) });
  return parts;
}

export interface StackFrame {
  /** The function, when the frame names one. */
  fn?: string;
  /** The script URL as captured, or what the engine wrote instead (`<anonymous>`, `native`). */
  file: string;
  line?: number;
  column?: number;
}

const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;
const GECKO_FRAME = /^\s*(.*?)@(.+?):(\d+):(\d+)$/;
/** A V8 frame with no location: `at Array.forEach (<anonymous>)`, `at new Promise (native)`. */
const V8_BARE_FRAME = /^\s+at (.+?)(?: \(([^()]*)\))?$/;

/**
 * Stack frames found in the message text: a thrown error's stack is captured as part of its message (Chrome's
 * `at fn (url:line:col)` or Firefox's `fn@url:line:col`). Nothing is inferred when there are none.
 */
export function stackFrames(message: string): StackFrame[] {
  return message.split('\n').flatMap((line): StackFrame[] => {
    const match = V8_FRAME.exec(line) ?? GECKO_FRAME.exec(line);
    if (match) {
      const [, fn, file = '', lineNumber = '0', column = '0'] = match;
      return [{ ...(fn ? { fn } : {}), file, line: Number(lineNumber), column: Number(column) }];
    }
    const bare = V8_BARE_FRAME.exec(line);
    return bare ? [{ fn: bare[1] ?? '', file: bare[2] ?? '' }] : [];
  });
}

/** The message without its stack frames: what the error said. */
export function headline(message: string) {
  return message
    .split('\n')
    .filter((line) => !V8_FRAME.test(line) && !GECKO_FRAME.test(line) && !V8_BARE_FRAME.test(line))
    .join('\n')
    .trim();
}

/** `https://shop.test/assets/app.js` → `assets/app.js`: the part of a frame's URL that names the file. */
export function frameFile(file: string) {
  try {
    const url = new URL(file);
    return url.pathname.replace(/^\//, '') || url.host;
  } catch {
    return file;
  }
}

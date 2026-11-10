import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { flagMap } from '../capture/bundle-io.ts';
import { ReviewSuiteHttpError } from '../capture/review-suite.ts';
import { createTerminal, failureHint, type Terminal } from '../capture/terminal.ts';
import { PRODUCT_SLUG } from '../shared/brand.ts';
import { assertReplayId } from '../shared/replay.ts';
import { assertSummary, type ReviewRunStatus } from '../shared/review-suite.ts';
import { RUN_ID_PATTERN } from './plan.ts';

export class UsageError extends Error {
  readonly exitCode = 2;
}

const CONNECTION = ['server', 'upload-url', 'header-file'];

export interface Parsed {
  positionals: string[];
  values: Record<string, string>;
  lists: Record<string, string[]>;
  booleans: Set<string>;
}

export interface ParseSpec {
  command: string;
  positionals: number;
  values?: string[];
  booleans?: string[];
}

export function parse(argv: string[], spec: ParseSpec): Parsed {
  const booleans = new Set(['json', ...(spec.booleans ?? [])]);
  const split = argv.findIndex((token) => token.startsWith('--') && token !== '--');
  const head = split === -1 ? argv : argv.slice(0, split);
  const positionals = head.filter((token) => token !== '--');
  if (positionals.length !== spec.positionals)
    throw new UsageError(
      `${PRODUCT_SLUG} suite ${spec.command} takes ${spec.positionals} argument${spec.positionals === 1 ? '' : 's'}, got ${positionals.length}; see \`${PRODUCT_SLUG} suite --help\``,
    );
  const known = new Set([...booleans, ...(spec.values ?? []), ...CONNECTION]);
  const parsed = flagMap(split === -1 ? [] : argv.slice(split), booleans);
  for (const name of [...Object.keys(parsed.values), ...parsed.booleans])
    if (!known.has(name)) throw new UsageError(`unknown option --${name} for suite ${spec.command}; see \`${PRODUCT_SLUG} suite --help\``);
  return { positionals, ...parsed };
}

/** Plain text, or `@file` for the file's text. */
export async function textArgument(raw: string | undefined, name: string): Promise<string | undefined> {
  if (raw === undefined) return undefined;
  let text = raw;
  if (raw.startsWith('@')) {
    try {
      text = await readFile(resolve(raw.slice(1)), 'utf8');
    } catch {
      throw new UsageError(`${name}: cannot read ${raw.slice(1)}`);
    }
  }
  text = text.replace(/\r\n/g, '\n').trim();
  try {
    assertSummary(text, name);
  } catch {
    throw new UsageError(
      `${name} must be 1 to 4000 characters of plain text without control characters (paragraphs split by blank lines and "- " bullet lines)`,
    );
  }
  return text;
}

export function need(values: Record<string, string>, name: string, command: string): string {
  const value = values[name];
  if (!value) throw new UsageError(`suite ${command} needs --${name}; see \`${PRODUCT_SLUG} suite --help\``);
  return value;
}

export function suiteId(value: string | undefined) {
  try {
    return assertReplayId(value ?? '');
  } catch {
    throw new UsageError('suite id must contain lowercase letters, digits and dashes (at most 80)');
  }
}

export function runId(value: string | undefined) {
  if (!value || !RUN_ID_PATTERN.test(value)) throw new UsageError('run id must contain letters, digits and hyphens (at most 80)');
  return value;
}

const STATUSES: readonly ReviewRunStatus[] = ['running', 'passed', 'failed', 'partial'];

export function status(value: string | undefined): ReviewRunStatus | undefined {
  if (value === undefined) return undefined;
  const found = STATUSES.find((item) => item === value);
  if (!found) throw new UsageError(`--status must be one of ${STATUSES.join(', ')}`);
  return found;
}

export function suiteHint(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ReviewSuiteHttpError) {
    const { status: code } = error;
    if (code === 0) return 'Check the server address (`replays config`) and your network connection.';
    if (code === 401 || code === 403)
      return 'This account may not manage suites. Behind a sign-in proxy pass the host credentials with --header-file; otherwise run `replays login`.';
    if (code === 404) return 'Check the suite id with `replays suite list`.';
    if (code === 409) return 'A suite keeps its title, source and profile, and a run keeps its label and finished status; use a new id.';
    if (code === 400 || code === 413 || code === 422) return 'The server refused a field; the message says which.';
    if (code >= 500) return 'The server had a problem; try again in a moment.';
  }
  return failureHint(message);
}

export function report(error: unknown, json: boolean, env: NodeJS.ProcessEnv) {
  const message = error instanceof Error ? error.message : String(error);
  const hint = suiteHint(error);
  const term = createTerminal({ env, stream: process.stderr, json });
  if (term.fancy) process.stderr.write(`\n${term.failed(message)}${hint ? `\n  ${term.dim(`→ ${hint}`)}` : ''}\n`);
  else process.stderr.write(`${JSON.stringify({ success: false, error: message, ...(hint ? { hint } : {}) })}\n`);
  process.exitCode =
    typeof error === 'object' && error !== null && 'exitCode' in error && typeof error.exitCode === 'number' ? error.exitCode : 1;
}

export const print = (text: string) => process.stdout.write(`${text}\n`);
export const printJson = (value: Record<string, unknown>) => print(JSON.stringify({ success: true, ...value }));

export const seconds = (ms: number | undefined) => (ms === undefined ? '-' : `${(ms / 1000).toFixed(1)}s`);

export function firstLine(text: string | undefined, max = 60) {
  const line =
    (text ?? '')
      .split('\n')
      .find((part) => part.trim())
      ?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const GOOD = new Set(['passed', 'Complete']);
const BAD = new Set(['failed', 'upload-failed', 'Failed']);
const WAITING = new Set(['running', 'Running', 'partial', 'Partial']);

export function paint(term: Terminal, state: string) {
  if (GOOD.has(state)) return term.green(state);
  if (BAD.has(state)) return term.red(state);
  return WAITING.has(state) ? term.yellow(state) : term.dim(state);
}

export interface Cell {
  text: string;
  shown?: string;
}

export function table(term: Terminal, header: string[], rows: Cell[][]) {
  const widths = header.map((name, column) => Math.max(name.length, ...rows.map((row) => row[column]?.text.length ?? 0)));
  const line = (cells: Cell[]) =>
    `  ${cells
      .map((cell, column) => (cell.shown ?? cell.text) + ' '.repeat(Math.max(0, (widths[column] ?? 0) - cell.text.length)))
      .join('  ')
      .trimEnd()}`;
  return [term.dim(line(header.map((name) => ({ text: name })))), ...rows.map(line)].join('\n');
}

/**
 * The Markdown subset a suite or run `summary` may use. It is parsed here into plain data and drawn as React elements, so a
 * summary stays text on the wire and is never turned into HTML.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; label: string };

export interface ListItem {
  text: string;
  children?: ListBlock;
}

export interface ListBlock {
  kind: 'list';
  ordered: boolean;
  items: ListItem[];
}

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | ListBlock;

export type ResultTone = 'pass' | 'fail' | 'partial';

export interface ResultLine {
  status: string;
  tone: ResultTone;
  qualifier?: string;
  rest: string;
}

const LIST_ITEM = /^(\s*)([-*]|\d{1,3}[.)])\s+(\S.*)$/;
const HEADING = /^#{1,3}\s+(\S.*?)\s*#*$/;
const FENCE = /^\s*```/;
const QUOTE = /^\s*>\s?(.*)$/;
// why: Toki leads lines with a short label ("Checked:", "Result:", "Good enough:"); bolding it makes the text scannable.
const LEAD_LABEL = /^([A-Z][A-Za-z ]{0,23}):\s+(\S.*)$/s;
const RESULT_LINE = /^Result:\s+([A-Za-z]+)(?:\s*\(([^)]*)\))?[\s.,:;-]*(.*)$/s;
const SAFE_URL = /^https?:\/\/[^\s<>]+$/i;

const RESULT_TONES: Record<string, ResultTone> = {
  pass: 'pass',
  passed: 'pass',
  ok: 'pass',
  success: 'pass',
  fail: 'fail',
  failed: 'fail',
  failure: 'fail',
  error: 'fail',
  partial: 'partial',
  partially: 'partial',
  mixed: 'partial',
  inconclusive: 'partial',
  blocked: 'partial',
};

/** A line's short leading label and the rest, or undefined when it has none. */
export function leadLabel(text: string): { label: string; rest: string } | undefined {
  const match = LEAD_LABEL.exec(text);
  return match?.[1] && match[2] ? { label: match[1], rest: match[2] } : undefined;
}

/** `Result: Fail (mocked responses)` as a status, its tag and any trailing text; undefined for an unrecognised status word. */
export function parseResult(text: string): ResultLine | undefined {
  const match = RESULT_LINE.exec(text);
  const status = match?.[1];
  const tone = status ? RESULT_TONES[status.toLowerCase()] : undefined;
  if (!match || !status || !tone) return undefined;
  const qualifier = match[2]?.trim();
  return { status, tone, ...(qualifier ? { qualifier } : {}), rest: match[3]?.trim() ?? '' };
}

function appendItem(blocks: Block[], match: RegExpExecArray): void {
  const indent = match[1]?.replace(/\t/g, '  ').length ?? 0;
  const ordered = /^\d/.test(match[2] ?? '');
  const item: ListItem = { text: (match[3] ?? '').trim() };
  const last = blocks.at(-1);
  if (indent >= 2 && last?.kind === 'list') {
    const parent = last.items.at(-1);
    if (parent) {
      // invariant: nesting stops at one level; deeper markers join the child list.
      if (parent.children?.ordered === ordered) parent.children.items.push(item);
      else parent.children = { kind: 'list', ordered, items: [item] };
      return;
    }
  }
  if (last?.kind === 'list' && last.ordered === ordered) last.items.push(item);
  else blocks.push({ kind: 'list', ordered, items: [item] });
}

type Line =
  | { kind: 'fence' | 'blank' | 'text' }
  | { kind: 'quote'; text: string }
  | { kind: 'item'; match: RegExpExecArray }
  | { kind: 'heading'; level: 2 | 3; text: string };

function classify(line: string): Line {
  if (FENCE.test(line)) return { kind: 'fence' };
  const quoted = QUOTE.exec(line)?.[1];
  if (quoted !== undefined) return { kind: 'quote', text: quoted.trim() };
  const item = LIST_ITEM.exec(line);
  if (item) return { kind: 'item', match: item };
  const heading = HEADING.exec(line.trim())?.[1];
  if (heading) return { kind: 'heading', level: line.trim().startsWith('###') ? 3 : 2, text: heading };
  return line.trim() ? { kind: 'text' } : { kind: 'blank' };
}

/** An indented line right after a list item continues that item (or its last nested item). */
function continueItem(blocks: Block[], line: string): boolean {
  const list = blocks.at(-1);
  if (list?.kind !== 'list' || !/^\s{2,}\S/.test(line)) return false;
  const target = list.items.at(-1)?.children?.items.at(-1) ?? list.items.at(-1);
  if (target) target.text += ` ${line.trim()}`;
  return Boolean(target);
}

interface Pending {
  blocks: Block[];
  paragraph: string[];
  quote: string[];
}

function flush(pending: Pending): void {
  if (pending.paragraph.length) pending.blocks.push({ kind: 'p', text: pending.paragraph.join(' ') });
  if (pending.quote.length) pending.blocks.push({ kind: 'quote', text: pending.quote.join(' ') });
  pending.paragraph.splice(0);
  pending.quote.splice(0);
}

/** Adds one line outside a code fence. */
function addLine(pending: Pending, next: Exclude<Line, { kind: 'fence' }>, line: string): void {
  const { blocks, paragraph, quote } = pending;
  if (next.kind === 'quote') {
    if (paragraph.length) flush(pending);
    pending.quote.push(next.text);
  } else if (next.kind === 'item') {
    flush(pending);
    appendItem(blocks, next.match);
  } else if (next.kind === 'heading') {
    flush(pending);
    blocks.push({ kind: 'heading', level: next.level, text: next.text });
  } else if (next.kind === 'blank') {
    flush(pending);
  } else if (paragraph.length || quote.length || !continueItem(blocks, line)) {
    if (quote.length || (paragraph.length && leadLabel(line.trim()))) flush(pending);
    pending.paragraph.push(line.trim());
  }
}

/** Splits a summary into blocks. Lines that start a new "Label:" begin a new paragraph so Toki's report lines stay apart. */
export function summaryBlocks(summary: string): Block[] {
  const pending: Pending = { blocks: [], paragraph: [], quote: [] };
  let code: string[] | undefined;
  for (const line of summary.replace(/\r\n?/g, '\n').split('\n')) {
    const next = classify(line);
    if (next.kind !== 'fence') {
      if (code) code.push(line);
      else addLine(pending, next, line);
    } else if (code) {
      pending.blocks.push({ kind: 'code', text: code.join('\n') });
      code = undefined;
    } else {
      flush(pending);
      code = [];
    }
  }
  if (code) pending.blocks.push({ kind: 'code', text: code.join('\n') });
  flush(pending);
  return pending.blocks;
}

const MAX_SHORT_URL = 44;

/** A bare URL as people say it: `o/r#12` for a GitHub pull request or issue, otherwise the host and a trimmed path. */
export function shortenUrl(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  const host = url.hostname.replace(/^www\./, '');
  const github = host === 'github.com' ? /^\/([^/]+)\/([^/]+)\/(?:pull|issues)\/(\d+)/.exec(url.pathname) : null;
  if (github) {
    const ref = `${github[1]}/${github[2]}#${github[3]}`;
    return url.hash.startsWith('#issuecomment-') ? `Comment on ${ref}` : ref;
  }
  const path = url.pathname.replace(/\/+$/, '');
  const short = `${host}${path}`;
  return short.length > MAX_SHORT_URL ? `${short.slice(0, MAX_SHORT_URL - 1)}…` : short;
}

const TRAILING = /[.,;:!?'"]+$/;

function bareUrl(rest: string): string | undefined {
  const raw = /^https?:\/\/[^\s<>]+/i.exec(rest)?.[0];
  if (!raw) return undefined;
  let url = raw.replace(TRAILING, '');
  // why: a closing parenthesis belongs to the URL only when it opens one inside it.
  while (url.endsWith(')') && !url.includes('(')) url = url.slice(0, -1).replace(TRAILING, '');
  return url;
}

type Match = { node: Inline; length: number };

function matchCode(text: string, i: number): Match | undefined {
  const end = text.indexOf('`', i + 1);
  return end > i + 1 ? { node: { kind: 'code', text: text.slice(i + 1, end) }, length: end + 1 - i } : undefined;
}

function matchStrong(text: string, i: number): Match | undefined {
  let end = text.indexOf('**', i + 3);
  // why: in `**b *c***` the last two stars close the bold; the one before them closes the italic.
  while (end > 0 && text[end + 2] === '*') end += 1;
  if (end < 0 || /\s/.test(text[i + 2] ?? '') || /\s/.test(text[end - 1] ?? '')) return undefined;
  return { node: { kind: 'strong', children: parseInline(text.slice(i + 2, end)) }, length: end + 2 - i };
}

function matchEm(text: string, i: number): Match | undefined {
  const marker = text[i] ?? '';
  const wordBefore = marker === '_' && /\w/.test(text[i - 1] ?? '');
  const end = text.indexOf(marker, i + 2);
  if (wordBefore || end < 0 || /\s/.test(text[i + 1] ?? ' ') || /\s/.test(text[end - 1] ?? ' ') || text[end - 1] === marker)
    return undefined;
  if (marker === '_' && /\w/.test(text[end + 1] ?? '')) return undefined;
  return { node: { kind: 'em', children: parseInline(text.slice(i + 1, end)) }, length: end + 1 - i };
}

function matchLink(text: string, i: number): Match | undefined {
  const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(text.slice(i));
  if (!link?.[1] || !link[2] || !SAFE_URL.test(link[2])) return undefined;
  return { node: { kind: 'link', href: link[2], label: link[1] }, length: link[0].length };
}

function matchBareUrl(text: string, i: number): Match | undefined {
  const url = /\w/.test(text[i - 1] ?? '') ? undefined : bareUrl(text.slice(i));
  return url ? { node: { kind: 'link', href: url, label: shortenUrl(url) }, length: url.length } : undefined;
}

function matchAt(text: string, i: number): Match | undefined {
  const char = text[i];
  if (char === '`') return matchCode(text, i);
  if (char === '*' && text[i + 1] === '*') return matchStrong(text, i);
  if (char === '*' || char === '_') return matchEm(text, i);
  if (char === '[') return matchLink(text, i);
  return char === 'h' || char === 'H' ? matchBareUrl(text, i) : undefined;
}

/** Inline code, bold, italic, links and bare URLs. Unclosed markers and non-http(s) links stay as the text they were. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  let i = 0;
  while (i < text.length) {
    const match = matchAt(text, i);
    if (match) {
      if (buffer) out.push({ kind: 'text', text: buffer });
      buffer = '';
      out.push(match.node);
      i += match.length;
    } else {
      buffer += text[i];
      i += 1;
    }
  }
  if (buffer) out.push({ kind: 'text', text: buffer });
  return out;
}

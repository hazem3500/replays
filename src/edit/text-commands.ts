import { MAX_LABEL } from '../shared/edits.ts';
import type { ParsedArgs } from './args.ts';
import { must, usageError } from './errors.ts';
import * as ops from './ops.ts';
import { type EditOutput, mutate, only, positionals, type Session, timeRange } from './session.ts';
import { formatTime, parseTime } from './time.ts';

async function captionAdd(session: Session, args: ParsedArgs): Promise<EditOutput> {
  only(args, ['from', 'to'], 'caption add');
  const [, text] = positionals(args, { min: 2, max: 2 }, 'caption add --from 3s --to 6s "text"');
  const range = timeRange(args, await session.context(), 'caption add');
  return mutate(session, 'caption add', `Added caption ${formatTime(range.from)}–${formatTime(range.to)}`, (edits) =>
    ops.addCaption(edits, range, must(text).trim()),
  );
}

async function captionEdit(session: Session, args: ParsedArgs): Promise<EditOutput> {
  only(args, ['from', 'to'], 'caption edit');
  const [, which, newText] = positionals(args, { min: 2, max: 3 }, 'caption edit <n> [--from t] [--to t] ["text"]');
  const { duration } = await session.context();
  const number = ops.parseNumber(which, 'the caption number');
  const change = {
    ...(args.values.from === undefined ? {} : { from: parseTime(args.values.from, duration) }),
    ...(args.values.to === undefined ? {} : { to: parseTime(args.values.to, duration) }),
    ...(newText === undefined ? {} : { text: newText.trim() }),
  };
  if (Object.keys(change).length === 0) throw usageError('caption edit needs new text, --from or --to');
  const target = ops.pinnedTarget('captions', number);
  return mutate(session, 'caption edit', `Edited caption ${number}`, (edits) => ops.updateCaption(edits, target(edits), change));
}

function removeNumbered(session: Session, args: ParsedArgs, key: 'captions' | 'highlights', name: string) {
  only(args, [], `${name} rm`);
  const number = ops.parseNumber(positionals(args, { min: 2, max: 2 }, `${name} rm <n>`)[1], `the ${name} number`);
  const target = ops.pinnedTarget(key, number);
  return mutate(session, `${name} rm`, `Removed ${name} ${number}`, (edits) => ops.removeItem(edits, key, target(edits)));
}

export function caption(session: Session, args: ParsedArgs): Promise<EditOutput> {
  const sub = args.positionals[0];
  if (sub === 'add') return captionAdd(session, args);
  if (sub === 'edit') return captionEdit(session, args);
  if (sub === 'rm') return removeNumbered(session, args, 'captions', 'caption');
  throw usageError('usage: replays edit <id> caption add --from 3s --to 6s "text"  |  caption edit <n> ...  |  caption rm <n>');
}

const HIGHLIGHT_USAGE =
  'usage: replays edit <id> highlight add --at 14.9s ["label"]  |  highlight add --from 3s --to 6s ["label"]  |  highlight rm <n>';

async function highlightAdd(session: Session, args: ParsedArgs): Promise<EditOutput> {
  only(args, ['at', 'from', 'to'], 'highlight add');
  const [, label] = positionals(args, { min: 1, max: 2 }, HIGHLIGHT_USAGE);
  const context = await session.context();
  const note = label?.trim();
  if (note && note.length > MAX_LABEL) throw usageError(`a highlight label is at most ${MAX_LABEL} characters`);
  if (args.values.at === undefined) {
    const range = timeRange(args, context, 'highlight add');
    return mutate(session, 'highlight add', `Added highlight ${formatTime(range.from)}–${formatTime(range.to)}`, (edits) =>
      ops.addHighlight(edits, range, note),
    );
  }
  if (args.values.from !== undefined || args.values.to !== undefined) throw usageError('give --at, or --from and --to, not both');
  const at = parseTime(args.values.at, context.duration);
  return mutate(session, 'highlight add', `Added highlight at ${formatTime(at)}`, (edits) => ops.addHighlight(edits, { at }, note));
}

export function highlight(session: Session, args: ParsedArgs): Promise<EditOutput> {
  const sub = args.positionals[0];
  if (sub === 'add') return highlightAdd(session, args);
  if (sub === 'rm') return removeNumbered(session, args, 'highlights', 'highlight');
  throw usageError(HIGHLIGHT_USAGE);
}

import type { Terminal } from '../capture/terminal.ts';
import { assertReplayEdits, type ReplayEdits } from '../shared/edits.ts';
import type { ReplayBundle } from '../shared/replay.ts';
import type { ParsedArgs } from './args.ts';
import type { EditClient } from './client.ts';
import { changeLines, type EditChanges } from './describe.ts';
import { messageOf, usageError } from './errors.ts';
import { modifyEdits } from './modify.ts';
import type * as ops from './ops.ts';
import { formatTime, parseTime } from './time.ts';

export interface EditOutput {
  json: Record<string, unknown>;
  text: (term: Terminal) => string;
}

const COMMON = ['server', 'header-file', 'json', 'help'];

export function only(args: ParsedArgs, allowed: readonly string[], command: string) {
  const given = [...Object.keys(args.values), ...args.booleans];
  const stray = given.find((name) => !COMMON.includes(name) && !allowed.includes(name));
  if (stray) throw usageError(`${command} does not take --${stray}; run \`replays edit --help\``);
}

export const required = (args: ParsedArgs, name: string, command: string) => {
  const value = args.values[name];
  if (value === undefined) throw usageError(`${command} needs --${name}`);
  return value;
};

export function positionals(args: ParsedArgs, count: { min: number; max: number }, usage: string) {
  if (args.positionals.length < count.min || args.positionals.length > count.max) throw usageError(`usage: replays edit <id> ${usage}`);
  return args.positionals;
}

export function numberFlag(text: string, name: string) {
  const value = Number(text);
  if (!text.trim() || !Number.isFinite(value)) throw usageError(`--${name} must be a number, not "${text}"`);
  return value;
}

export function booleanFlag(text: string, name: string) {
  if (text === 'true') return true;
  if (text === 'false') return false;
  throw usageError(`--${name} must be true or false`);
}

export interface Session {
  client: EditClient;
  json: boolean;
  stderr: Pick<NodeJS.WriteStream, 'write' | 'isTTY'>;
  env: NodeJS.ProcessEnv;
  bundle: () => Promise<ReplayBundle>;
  context: () => Promise<ops.EditContext>;
}

export function checkEdits(edits: unknown, duration: number): asserts edits is ReplayEdits {
  try {
    assertReplayEdits(edits, duration);
  } catch (error) {
    throw usageError(`that edit is not valid: ${messageOf(error)}`);
  }
}

export const validator = (duration: number) => (edits: ReplayEdits) => checkEdits(edits, duration);

export function changesText(term: Terminal, changes: EditChanges) {
  return changeLines(changes).map((line) => `  ${term.dim(line.slice(0, 1))}${line.slice(1)}`);
}

export function mutationOutput(
  session: Session,
  summary: { action: string; headline: string },
  result: Awaited<ReturnType<typeof modifyEdits>>,
): EditOutput {
  const { action, headline } = summary;
  const { client } = session;
  return {
    json: {
      success: true,
      id: client.id,
      link: client.link,
      action,
      changed: result.changed,
      revision: result.saved.revision,
      retried: result.retries > 0,
      changes: result.changes,
      edits: result.saved,
    },
    text: (term) =>
      [
        result.changed
          ? term.ok(`${headline} (revision ${result.saved.revision})`)
          : term.warn('Nothing to change: the replay already has this.'),
        ...changesText(term, result.changes),
        ...(result.retries > 0 ? [term.dim('  someone saved at the same moment; your change was applied on top of theirs')] : []),
        `  ${term.dim('Viewer')}  ${term.link(client.link)}`,
      ].join('\n'),
  };
}

export async function mutate(
  session: Session,
  action: string,
  headline: string,
  change: (edits: ReplayEdits) => ReplayEdits,
): Promise<EditOutput> {
  const context = await session.context();
  const result = await modifyEdits(session.client, change, { validate: validator(context.duration) });
  return mutationOutput(session, { action, headline }, result);
}

export function timeRange(args: ParsedArgs, context: ops.EditContext, command: string) {
  const from = parseTime(required(args, 'from', command), context.duration);
  const to = parseTime(required(args, 'to', command), context.duration);
  if (to <= from) throw usageError(`${command}: --to (${formatTime(to)}) must be after --from (${formatTime(from)})`);
  return { from, to };
}

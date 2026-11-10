import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createTerminal, type Terminal } from '../capture/terminal.ts';
import { reportFailure } from '../capture/upload.ts';
import { BLUR_STYLES, MAX_SPEED_RATE, MIN_SPEED_RATE } from '../shared/effects.ts';
import { assertReplayEdits, bundleSpan, editListOf, MAX_LABEL, normalizeEdits, type ReplayEdits } from '../shared/edits.ts';
import type { ReplayBundle } from '../shared/replay.ts';
import { type ParsedArgs, parseArgs } from './args.ts';
import { resolveTarget, type TargetOptions } from './auth.ts';
import { EditClient } from './client.ts';
import { changeLines, diffEdits, type EditChanges, listEdits, noChanges } from './describe.ts';
import { EditError, must, usageError } from './errors.ts';
import { assertFreeFile, defaultVideoName, exportParams, parseExportSpeed, renderVideo } from './export.ts';
import { modifyEdits } from './modify.ts';
import * as ops from './ops.ts';
import { formatTime, parseTime } from './time.ts';
import { resolveStep, stepRows } from './steps.ts';

export interface EditCliOptions {
  /** The one server a credential-attaching wrapper approves; other servers are refused. */
  trustedServerUrl?: string;
  /** Replaces `fetch`, for tests. */
  fetch?: typeof fetch;
  /** The CLI config file to read the saved server from; the platform default when absent. */
  configPath?: string;
  stderr?: Pick<NodeJS.WriteStream, 'write' | 'isTTY'>;
}

export interface EditOutput {
  json: Record<string, unknown>;
  text: (term: Terminal) => string;
}

const VALUE_FLAGS = [
  'server',
  'header-file',
  'from',
  'to',
  'at',
  'rate',
  'rect',
  'scale',
  'min',
  'label',
  'speed',
  'output',
  'timeout',
  'size',
  'motion',
  'appearance',
  'color',
  'click-effect',
  'visible',
  'hide-when-idle',
  'click-feedback',
  'selector',
];
const BOOLEAN_FLAGS = ['json', 'force', 'dry-run', 'reset', 'captions', 'full', 'help'];
const COMMON = ['server', 'header-file', 'json', 'help'];

const COMMANDS = [
  'show',
  'pull',
  'push',
  'rename',
  'cut',
  'speed',
  'zoom',
  'blur',
  'remove',
  'caption',
  'highlight',
  'trim',
  'cursor',
  'undo',
  'export',
];

function only(args: ParsedArgs, allowed: readonly string[], command: string) {
  const given = [...Object.keys(args.values), ...args.booleans];
  const stray = given.find((name) => !COMMON.includes(name) && !allowed.includes(name));
  if (stray) throw usageError(`${command} does not take --${stray}; run \`replays edit --help\``);
}

const required = (args: ParsedArgs, name: string, command: string) => {
  const value = args.values[name];
  if (value === undefined) throw usageError(`${command} needs --${name}`);
  return value;
};

function positionals(args: ParsedArgs, count: { min: number; max: number }, usage: string) {
  if (args.positionals.length < count.min || args.positionals.length > count.max) throw usageError(`usage: replays edit <id> ${usage}`);
  return args.positionals;
}

function numberFlag(text: string, name: string) {
  const value = Number(text);
  if (!text.trim() || !Number.isFinite(value)) throw usageError(`--${name} must be a number, not "${text}"`);
  return value;
}

function booleanFlag(text: string, name: string) {
  if (text === 'true') return true;
  if (text === 'false') return false;
  throw usageError(`--${name} must be true or false`);
}

interface Session {
  client: EditClient;
  json: boolean;
  stderr: Pick<NodeJS.WriteStream, 'write' | 'isTTY'>;
  env: NodeJS.ProcessEnv;
  bundle: () => Promise<ReplayBundle>;
  context: () => Promise<ops.EditContext>;
}

function checkEdits(edits: unknown, duration: number): asserts edits is ReplayEdits {
  try {
    assertReplayEdits(edits, duration);
  } catch (error) {
    throw usageError(`that edit is not valid: ${(error as Error).message}`);
  }
}

const validator = (duration: number) => (edits: ReplayEdits) => checkEdits(edits, duration);

function changesText(term: Terminal, changes: EditChanges) {
  return changeLines(changes).map((line) => `  ${term.dim(line.slice(0, 1))}${line.slice(1)}`);
}

function mutationOutput(
  session: Session,
  action: string,
  headline: string,
  result: Awaited<ReturnType<typeof modifyEdits>>,
  extra: Record<string, unknown> = {},
): EditOutput {
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
      ...extra,
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

async function mutate(
  session: Session,
  action: string,
  headline: string,
  change: (edits: ReplayEdits) => ReplayEdits,
): Promise<EditOutput> {
  const context = await session.context();
  const result = await modifyEdits(session.client, change, { validate: validator(context.duration) });
  return mutationOutput(session, action, headline, result);
}

function timeRange(args: ParsedArgs, context: ops.EditContext, command: string) {
  const from = parseTime(required(args, 'from', command), context.duration);
  const to = parseTime(required(args, 'to', command), context.duration);
  if (to <= from) throw usageError(`${command}: --to (${formatTime(to)}) must be after --from (${formatTime(from)})`);
  return { from, to };
}

async function show(session: Session): Promise<EditOutput> {
  const [bundle, current] = await Promise.all([session.bundle(), session.client.getEdits()]);
  const edits = normalizeEdits(editListOf(current.edits));
  const rows = stepRows(bundle.steps, edits.stepNames);
  const { client } = session;
  return {
    json: {
      success: true,
      id: client.id,
      link: client.link,
      title: bundle.meta.title,
      duration: bundleSpan(bundle),
      revision: current.edits.revision,
      ...(current.edits.updatedBy ? { updatedBy: current.edits.updatedBy } : {}),
      ...(current.edits.updatedAt ? { updatedAt: current.edits.updatedAt } : {}),
      edits: { ...current.edits, ...edits },
      steps: rows.map(({ number, at, time, label, kind, key, renamed, folded }) => ({
        index: number,
        at,
        time,
        label,
        kind,
        key,
        ...(renamed ? { renamed } : {}),
        ...(folded ? { folded } : {}),
      })),
    },
    text: (term) => {
      const saved =
        current.edits.revision > 0
          ? `revision ${current.edits.revision}${current.edits.updatedBy ? `, saved by ${current.edits.updatedBy}` : ''}`
          : 'never edited';
      return [
        `${term.bold(bundle.meta.title)}  ${term.dim(`${client.id} · ${formatTime(bundleSpan(bundle))} · ${saved}`)}`,
        term.link(client.link),
        '',
        term.bold('Edits'),
        ...listEdits(edits).map((line) => `  ${line}`),
        '',
        term.bold('Steps'),
        ...rows.map(
          (row) =>
            `  ${String(row.number).padStart(3)}  ${row.time.padStart(7)}  ${row.label}${row.renamed ? term.dim('  (renamed)') : ''}${row.folded ? term.dim('  (part of the step above)') : ''}`,
        ),
      ].join('\n');
    },
  };
}

async function pull(session: Session, args: ParsedArgs): Promise<EditOutput> {
  only(args, ['output', 'force'], 'pull');
  positionals(args, { min: 0, max: 0 }, 'pull [-o edits.json]');
  const current = await session.client.getEdits();
  const text = `${JSON.stringify(current.edits, null, 2)}\n`;
  const { client } = session;
  const file = args.values.output;
  if (file) {
    await assertFreeFile(file, args.booleans.has('force'));
    await writeFile(resolve(file), text);
  }
  return {
    json: {
      success: true,
      id: client.id,
      link: client.link,
      revision: current.edits.revision,
      ...(file ? { file } : {}),
      edits: current.edits,
    },
    text: (term) =>
      file
        ? [term.ok(`Saved revision ${current.edits.revision} to ${file}`), `  ${term.dim('Viewer')}  ${term.link(client.link)}`].join('\n')
        : text.trimEnd(),
  };
}

async function push(session: Session, args: ParsedArgs): Promise<EditOutput> {
  only(args, ['force', 'dry-run'], 'push');
  const [file] = positionals(args, { min: 1, max: 1 }, 'push <edits.json> [--force] [--dry-run]');
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(resolve(must(file)), 'utf8'));
  } catch (error) {
    throw usageError(`could not read ${file} as JSON: ${(error as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw usageError(`${file} must hold a JSON object (the edit list)`);
  const { revision, updatedBy: _by, updatedAt: _at, ...list } = raw as Record<string, unknown>;
  const context = await session.context();
  const validate = validator(context.duration);
  checkEdits(list, context.duration);
  const next = normalizeEdits(list);
  const force = args.booleans.has('force');
  const current = await session.client.getEdits();
  const behind = typeof revision === 'number' && revision !== current.edits.revision;
  if (behind && !force)
    throw new EditError(
      `someone else edited this replay since ${file} was pulled (the file is at revision ${String(revision)}, the server at ${current.edits.revision}); run \`replays edit <id> pull\` again, or pass --force to overwrite what is on the server`,
    );
  const plan = diffEdits(normalizeEdits(editListOf(current.edits)), next);
  if (args.booleans.has('dry-run')) {
    const { client } = session;
    return {
      json: { success: true, id: client.id, link: client.link, action: 'push', dryRun: true, changed: !noChanges(plan), changes: plan },
      text: (term) =>
        [
          noChanges(plan) ? term.warn('The server already has these edits.') : term.ok('Dry run; nothing was saved. Pushing would:'),
          ...changesText(term, plan),
        ].join('\n'),
    };
  }
  if (!session.json && !noChanges(plan))
    session.stderr.write(
      `Pushing ${file}:\n${changeLines(plan)
        .map((line) => `  ${line}`)
        .join('\n')}\n`,
    );
  const result = await modifyEdits(session.client, () => next, { validate, retries: force ? 1 : 0 });
  return mutationOutput(session, 'push', `Pushed ${file}`, result);
}

async function rename(session: Session, args: ParsedArgs): Promise<EditOutput> {
  only(args, ['reset'], 'rename');
  const reset = args.booleans.has('reset');
  const [step, name] = positionals(args, { min: reset ? 1 : 2, max: reset ? 1 : 2 }, 'rename <step> "<name>"  |  rename <step> --reset');
  const bundle = await session.bundle();
  const row = resolveStep(stepRows(bundle.steps, undefined), must(step));
  const text = reset ? '' : must(name).trim();
  if (!reset && !text) throw usageError('the new name is empty; use --reset to go back to the automatic label');
  if (text.length > MAX_LABEL) throw usageError(`a step name is at most ${MAX_LABEL} characters (this one is ${text.length})`);
  return mutate(
    session,
    'rename',
    reset ? `Reset step ${row.number} (${row.time})` : `Renamed step ${row.number} (${row.time}) to “${text}”`,
    (edits) => ops.setStepName(edits, row.key, text),
  );
}

async function cut(session: Session, args: ParsedArgs): Promise<EditOutput> {
  const [sub, rest] = args.positionals;
  if (sub === 'rm') {
    only(args, [], 'cut rm');
    const number = ops.parseNumber(positionals(args, { min: 2, max: 2 }, 'cut rm <n>')[1], 'the cut number');
    const target = ops.pinnedTarget('cuts', number);
    return mutate(session, 'cut rm', `Removed cut ${number}`, (edits) => ops.removeItem(edits, 'cuts', target(edits)));
  }
  const context = await session.context();
  if (sub === 'waits') {
    only(args, ['min'], 'cut waits');
    positionals(args, { min: 1, max: 1 }, 'cut waits [--min 2s]');
    const min = args.values.min === undefined ? 0 : parseTime(args.values.min, context.duration);
    return mutate(session, 'cut waits', 'Cut the waits', (edits) => ops.addWaitCuts(edits, context, min));
  }
  only(args, ['from', 'to', 'label'], 'cut');
  if (sub !== undefined || rest !== undefined)
    throw usageError('usage: replays edit <id> cut --from 10s --to 18s  |  cut rm <n>  |  cut waits [--min 2s]');
  const { from, to } = timeRange(args, context, 'cut');
  const label = args.values.label;
  if (label && label.length > MAX_LABEL) throw usageError(`--label is at most ${MAX_LABEL} characters`);
  return mutate(session, 'cut', `Cut ${formatTime(from)}–${formatTime(to)}`, (edits) => ops.addCut(edits, from, to, label));
}

async function listCommand(
  session: Session,
  args: ParsedArgs,
  kind: {
    name: string;
    key: ops.ListKey;
    flags: string[];
    add: (edits: ReplayEdits, context: ops.EditContext, range: { from: number; to: number }) => ReplayEdits;
  },
): Promise<EditOutput> {
  if (args.positionals[0] === 'rm') {
    only(args, [], `${kind.name} rm`);
    const number = ops.parseNumber(positionals(args, { min: 2, max: 2 }, `${kind.name} rm <n>`)[1], `the ${kind.name} number`);
    const target = ops.pinnedTarget(kind.key, number);
    return mutate(session, `${kind.name} rm`, `Removed ${ops.ITEM_NAME[kind.key]} ${number}`, (edits) =>
      ops.removeItem(edits, kind.key, target(edits)),
    );
  }
  only(args, ['from', 'to', ...kind.flags], kind.name);
  positionals(args, { min: 0, max: 0 }, `${kind.name} --from 3s --to 6s ...  |  ${kind.name} rm <n>`);
  if (args.values.selector !== undefined)
    throw usageError('selector-based regions are not part of the edits format; give the box with --rect x,y,w,h');
  const context = await session.context();
  const range = timeRange(args, context, kind.name);
  return mutate(session, kind.name, `Added ${ops.ITEM_NAME[kind.key]} ${formatTime(range.from)}–${formatTime(range.to)}`, (edits) =>
    kind.add(edits, context, range),
  );
}

const speed = (session: Session, args: ParsedArgs) =>
  listCommand(session, args, {
    name: 'speed',
    key: 'speeds',
    flags: ['rate'],
    add: (edits, _context, { from, to }) => {
      const rate = numberFlag(required(args, 'rate', 'speed'), 'rate');
      if (rate < MIN_SPEED_RATE || rate > MAX_SPEED_RATE) throw usageError(`--rate must be from ${MIN_SPEED_RATE} to ${MAX_SPEED_RATE}`);
      return ops.addSpeed(edits, from, to, rate);
    },
  });

const zoom = (session: Session, args: ParsedArgs) =>
  listCommand(session, args, {
    name: 'zoom',
    key: 'zooms',
    flags: ['rect', 'scale', 'at', 'selector'],
    add: (edits, context, { from, to }) => {
      const { rect, scale, at } = args.values;
      if (rect !== undefined && at !== undefined) throw usageError('give --rect or --at, not both');
      return ops.addZoom(edits, {
        from,
        to,
        ...(rect === undefined ? {} : { rect: ops.parseRect(rect, context.viewport) }),
        ...(scale === undefined ? {} : { scale: numberFlag(scale, 'scale') }),
        ...(at === undefined ? {} : { at: ops.parsePoint(at, context.viewport) }),
      });
    },
  });

const region = (session: Session, args: ParsedArgs, name: 'blur' | 'remove') =>
  listCommand(session, args, {
    name,
    key: 'blurs',
    flags: ['rect', 'selector'],
    add: (edits, context, { from, to }) =>
      ops.addBlur(
        edits,
        from,
        to,
        ops.parseRect(required(args, 'rect', name), context.viewport),
        name === 'remove' ? BLUR_STYLES[1] : BLUR_STYLES[0],
      ),
  });

async function caption(session: Session, args: ParsedArgs): Promise<EditOutput> {
  const [sub, ...rest] = args.positionals;
  const context = await session.context();
  if (sub === 'add') {
    only(args, ['from', 'to'], 'caption add');
    const [, text] = positionals(args, { min: 2, max: 2 }, 'caption add --from 3s --to 6s "text"');
    const { from, to } = timeRange(args, context, 'caption add');
    return mutate(session, 'caption add', `Added caption ${formatTime(from)}–${formatTime(to)}`, (edits) =>
      ops.addCaption(edits, from, to, must(text).trim()),
    );
  }
  if (sub === 'rm') {
    only(args, [], 'caption rm');
    const number = ops.parseNumber(positionals(args, { min: 2, max: 2 }, 'caption rm <n>')[1], 'the caption number');
    const target = ops.pinnedTarget('captions', number);
    return mutate(session, 'caption rm', `Removed caption ${number}`, (edits) => ops.removeItem(edits, 'captions', target(edits)));
  }
  if (sub === 'edit') {
    only(args, ['from', 'to'], 'caption edit');
    positionals(args, { min: 2, max: 3 }, 'caption edit <n> [--from t] [--to t] ["text"]');
    const number = ops.parseNumber(rest[0], 'the caption number');
    const text = rest[1]?.trim();
    const from = args.values.from === undefined ? undefined : parseTime(args.values.from, context.duration);
    const to = args.values.to === undefined ? undefined : parseTime(args.values.to, context.duration);
    if (text === undefined && from === undefined && to === undefined) throw usageError('caption edit needs new text, --from or --to');
    const target = ops.pinnedTarget('captions', number);
    return mutate(session, 'caption edit', `Edited caption ${number}`, (edits) =>
      ops.updateItem(edits, 'captions', target(edits), (item) => ({
        ...item,
        ...(from === undefined ? {} : { from }),
        ...(to === undefined ? {} : { to }),
        ...(text === undefined ? {} : { text }),
      })),
    );
  }
  throw usageError('usage: replays edit <id> caption add --from 3s --to 6s "text"  |  caption edit <n> ...  |  caption rm <n>');
}

async function highlight(session: Session, args: ParsedArgs): Promise<EditOutput> {
  const [sub, ...rest] = args.positionals;
  if (sub === 'rm') {
    only(args, [], 'highlight rm');
    const number = ops.parseNumber(positionals(args, { min: 2, max: 2 }, 'highlight rm <n>')[1], 'the highlight number');
    const target = ops.pinnedTarget('highlights', number);
    return mutate(session, 'highlight rm', `Removed highlight ${number}`, (edits) => ops.removeItem(edits, 'highlights', target(edits)));
  }
  if (sub !== 'add' || rest.length > 1)
    throw usageError(
      'usage: replays edit <id> highlight add --at 14.9s ["label"]  |  highlight add --from 3s --to 6s ["label"]  |  highlight rm <n>',
    );
  only(args, ['at', 'from', 'to'], 'highlight add');
  const context = await session.context();
  const label = rest[0]?.trim();
  if (label && label.length > MAX_LABEL) throw usageError(`a highlight label is at most ${MAX_LABEL} characters`);
  if (args.values.at !== undefined) {
    if (args.values.from !== undefined || args.values.to !== undefined) throw usageError('give --at, or --from and --to, not both');
    const at = parseTime(args.values.at, context.duration);
    return mutate(session, 'highlight add', `Added highlight at ${formatTime(at)}`, (edits) => ops.addHighlight(edits, { at }, label));
  }
  const { from, to } = timeRange(args, context, 'highlight add');
  return mutate(session, 'highlight add', `Added highlight ${formatTime(from)}–${formatTime(to)}`, (edits) =>
    ops.addHighlight(edits, { from, to }, label),
  );
}

async function trim(session: Session, args: ParsedArgs): Promise<EditOutput> {
  only(args, ['from', 'to', 'reset'], 'trim');
  positionals(args, { min: 0, max: 0 }, 'trim --from 1s --to end  |  trim --reset');
  const context = await session.context();
  if (args.booleans.has('reset')) return mutate(session, 'trim', 'Removed the trim', (edits) => ops.setTrim(edits, undefined));
  if (args.values.from === undefined && args.values.to === undefined) throw usageError('trim needs --from and/or --to, or --reset');
  const start = args.values.from === undefined ? 0 : parseTime(args.values.from, context.duration);
  const end = args.values.to === undefined ? context.duration : parseTime(args.values.to, context.duration);
  if (end <= start) throw usageError(`trim: --to (${formatTime(end)}) must be after --from (${formatTime(start)})`);
  return mutate(session, 'trim', `Trimmed to ${formatTime(start)}–${formatTime(end)}`, (edits) => ops.setTrim(edits, { start, end }));
}

async function cursor(session: Session, args: ParsedArgs): Promise<EditOutput> {
  only(args, ['size', 'motion', 'appearance', 'color', 'click-effect', 'visible', 'hide-when-idle', 'click-feedback', 'reset'], 'cursor');
  positionals(args, { min: 0, max: 0 }, 'cursor [--size 1.5] [--appearance ring] ...  |  cursor --reset');
  if (args.booleans.has('reset')) return mutate(session, 'cursor', 'Reset the cursor', (edits) => ops.setCursor(edits, undefined));
  const { values } = args;
  const change: Record<string, unknown> = {
    ...(values.size === undefined ? {} : { size: numberFlag(values.size, 'size') }),
    ...(values.motion === undefined ? {} : { motion: values.motion }),
    ...(values.appearance === undefined ? {} : { appearance: values.appearance }),
    ...(values.color === undefined ? {} : { color: values.color }),
    ...(values['click-effect'] === undefined ? {} : { clickEffect: values['click-effect'] }),
    ...(values.visible === undefined ? {} : { visible: booleanFlag(values.visible, 'visible') }),
    ...(values['hide-when-idle'] === undefined ? {} : { hideWhenIdle: booleanFlag(values['hide-when-idle'], 'hide-when-idle') }),
    ...(values['click-feedback'] === undefined ? {} : { clickFeedback: booleanFlag(values['click-feedback'], 'click-feedback') }),
  };
  if (!Object.keys(change).length) throw usageError('cursor needs at least one setting, or --reset');
  return mutate(session, 'cursor', 'Changed the cursor', (edits) => ops.setCursor(edits, { ...edits.cursor, ...change }));
}

async function exportVideo(session: Session, args: ParsedArgs): Promise<EditOutput> {
  only(args, ['speed', 'captions', 'full', 'output', 'force', 'timeout'], 'export');
  positionals(args, { min: 0, max: 0 }, 'export [--speed 2] [--captions] [-o out.mp4]');
  const { client } = session;
  const current = await client.getEdits();
  const params = exportParams(editListOf(current.edits), {
    speed: parseExportSpeed(args.values.speed),
    captions: args.booleans.has('captions'),
    skipInactive: !args.booleans.has('full'),
  });
  const file = args.values.output ?? defaultVideoName(client.id, params);
  await assertFreeFile(file, args.booleans.has('force'));
  const timeoutMs = args.values.timeout === undefined ? 10 * 60_000 : parseTime(args.values.timeout.replace(/^(\d+)$/, '$1s'));
  const term = createTerminal({ env: session.env, stream: session.stderr, json: session.json });
  const spinner = term.spinner('Rendering the video');
  let lastLine = -1;
  try {
    await renderVideo(client, params, {
      timeoutMs,
      onProgress: (progress, status) => {
        const percent = Math.round(progress * 100);
        spinner.update(`Rendering the video ${percent}%`);
        if (!term.fancy && !session.json && percent - lastLine >= 10) {
          lastLine = percent;
          session.stderr.write(`${status} ${percent}%\n`);
        }
      },
    });
    spinner.update('Downloading the video');
    const bytes = await client.downloadRender(params, resolve(file));
    spinner.stop();
    return {
      json: {
        success: true,
        id: client.id,
        link: client.link,
        action: 'export',
        file,
        bytes,
        speed: params.speed,
        captions: params.captions,
        skipInactive: params.skipInactive,
        edited: Boolean(params.edits),
        revision: current.edits.revision,
      },
      text: (out) =>
        [
          out.ok(`Saved ${file}${bytes ? ` (${(bytes / 1_000_000).toFixed(1)} MB)` : ''}`),
          `  ${out.dim('Viewer')}  ${out.link(client.link)}`,
        ].join('\n'),
    };
  } finally {
    spinner.stop();
  }
}

function undo(): never {
  throw new EditError(
    'undo is not available: the server keeps only the current edit list, not a history. Before a big change run `replays edit <id> pull -o backup.json`; `push backup.json` goes back to it. Or remove one item (for example `cut rm 2`)',
  );
}

/** Runs one `replays edit` command and returns what it would print; throws `EditError` (or a sign-in error) on failure. */
export async function executeEdit(argv: readonly string[], env: NodeJS.ProcessEnv = {}, options: EditCliOptions = {}): Promise<EditOutput> {
  const args = parseArgs(argv, { values: VALUE_FLAGS, booleans: BOOLEAN_FLAGS });
  const [target, command, ...rest] = args.positionals;
  if (!target || !command) throw usageError('usage: replays edit <id|viewer-link> <command> ...; run `replays edit --help`');
  if (!COMMANDS.includes(command)) throw usageError(`unknown edit command "${command}"; run \`replays edit --help\``);
  args.positionals = rest;
  const json = args.booleans.has('json');
  if (command === 'undo') undo();
  const targetOptions: TargetOptions = {
    env,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) && !json,
    ...(args.values.server ? { serverName: args.values.server } : {}),
    ...(args.values['header-file'] ? { headerFile: args.values['header-file'] } : {}),
    ...(options.trustedServerUrl ? { trustedServerUrl: options.trustedServerUrl } : {}),
    ...(options.configPath ? { configPath: options.configPath } : {}),
  };
  const resolved = await resolveTarget(target, targetOptions);
  const client = new EditClient({
    server: resolved.server,
    id: resolved.id,
    headers: resolved.headers,
    authNote: resolved.authNote,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  let bundle: Promise<ReplayBundle> | undefined;
  const session: Session = {
    client,
    json,
    env,
    stderr: options.stderr ?? process.stderr,
    bundle: () => (bundle ??= client.bundle()),
    context: async () => {
      const loaded = await session.bundle();
      return { duration: bundleSpan(loaded), viewport: loaded.meta.viewport, steps: loaded.steps };
    },
  };
  switch (command) {
    case 'show':
      only(args, [], 'show');
      return show(session);
    case 'pull':
      return pull(session, args);
    case 'push':
      return push(session, args);
    case 'rename':
      return rename(session, args);
    case 'cut':
      return cut(session, args);
    case 'speed':
      return speed(session, args);
    case 'zoom':
      return zoom(session, args);
    case 'blur':
    case 'remove':
      return region(session, args, command);
    case 'caption':
      return caption(session, args);
    case 'highlight':
      return highlight(session, args);
    case 'trim':
      return trim(session, args);
    case 'cursor':
      return cursor(session, args);
    default:
      return exportVideo(session, args);
  }
}

/** `replays edit <id|link> <command> ...`; `options.trustedServerUrl` lets a wrapper that adds its own credentials pin the server. */
export async function runEditCli(argv: string[], env: NodeJS.ProcessEnv = {}, options: EditCliOptions = {}) {
  const json = argv.includes('--json');
  try {
    const output = await executeEdit(argv, env, options);
    if (json) process.stdout.write(`${JSON.stringify(output.json)}\n`);
    else process.stdout.write(`${output.text(createTerminal({ env, stream: process.stdout }))}\n`);
  } catch (error) {
    reportFailure(error, json, env);
  }
}

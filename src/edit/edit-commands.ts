import { BLUR_STYLES, MAX_SPEED_RATE, MIN_SPEED_RATE } from '../shared/effects.ts';
import { MAX_LABEL, type ReplayEdits } from '../shared/edits.ts';
import type { ParsedArgs } from './args.ts';
import { usageError, must } from './errors.ts';
import * as ops from './ops.ts';
import { booleanFlag, type EditOutput, mutate, numberFlag, only, positionals, required, type Session, timeRange } from './session.ts';
import { resolveStep, stepRows } from './steps.ts';
import { formatTime, parseTime } from './time.ts';

export async function rename(session: Session, args: ParsedArgs): Promise<EditOutput> {
  only(args, ['reset'], 'rename');
  const reset = args.booleans.has('reset');
  const [step, name] = positionals(args, { min: reset ? 1 : 2, max: reset ? 1 : 2 }, 'rename <step> "<name>"  |  rename <step> --reset');
  const bundle = await session.bundle();
  const row = resolveStep(stepRows(bundle.steps), must(step));
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

export async function cut(session: Session, args: ParsedArgs): Promise<EditOutput> {
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

export async function listCommand(
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

export const speed = (session: Session, args: ParsedArgs) =>
  listCommand(session, args, {
    name: 'speed',
    key: 'speeds',
    flags: ['rate'],
    add: (edits, _context, { from, to }) => {
      const rate = numberFlag(required(args, 'rate', 'speed'), 'rate');
      if (rate < MIN_SPEED_RATE || rate > MAX_SPEED_RATE) throw usageError(`--rate must be from ${MIN_SPEED_RATE} to ${MAX_SPEED_RATE}`);
      return ops.addSpeed(edits, { from, to }, rate);
    },
  });

export const zoom = (session: Session, args: ParsedArgs) =>
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

export const region = (session: Session, args: ParsedArgs, name: 'blur' | 'remove') =>
  listCommand(session, args, {
    name,
    key: 'blurs',
    flags: ['rect', 'selector'],
    add: (edits, context, { from, to }) =>
      ops.addBlur(edits, {
        from,
        to,
        rect: ops.parseRect(required(args, 'rect', name), context.viewport),
        style: name === 'remove' ? BLUR_STYLES[1] : BLUR_STYLES[0],
      }),
  });

export async function trim(session: Session, args: ParsedArgs): Promise<EditOutput> {
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

export async function cursor(session: Session, args: ParsedArgs): Promise<EditOutput> {
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

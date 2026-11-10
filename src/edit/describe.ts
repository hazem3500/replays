import type { ReplayEdits } from '../shared/edits.ts';
import { formatRange, formatTime } from './time.ts';
import { ITEM_NAME, itemsOf, LIST_KEYS, type ListKey } from './ops.ts';

const percent = (fraction: number) => `${Math.round(fraction * 1000) / 10}%`;
const quoted = (text: string) => `“${text}”`;

type AnyItem = ReturnType<typeof itemsOf<ListKey>>[number];

/** One edit item in a line: its stretch of the original timeline and what it does there. */
export function describeItem(key: ListKey, item: AnyItem): string {
  if ('at' in item) return `at ${formatTime(item.at)}${item.label ? ` ${quoted(item.label)}` : ''}`;
  const range = formatRange(item.from, item.to);
  switch (key) {
    case 'cuts':
      return `${range}${'label' in item && item.label ? ` ${quoted(item.label)}` : ''}`;
    case 'speeds':
      return `${range} at ${'rate' in item ? item.rate : ''}×`;
    case 'zooms':
      if (!('scale' in item)) return range;
      return `${range} ${item.scale}×${item.x === undefined ? ' following clicks' : ` around ${percent(item.x)},${percent(item.y ?? 0.5)}`}`;
    case 'blurs':
      if (!('width' in item)) return range;
      return `${range} ${item.style === 'redact' ? 'removed' : 'blurred'} box x ${percent(item.x)} y ${percent(item.y)} w ${percent(item.width)} h ${percent(item.height)}`;
    case 'captions':
      return `${range} ${'text' in item ? quoted(item.text) : ''}`;
    default:
      return `${range}${'label' in item && item.label ? ` ${quoted(item.label)}` : ''}`;
  }
}

export interface EditChanges {
  added: string[];
  removed: string[];
  changed: string[];
}

export const noChanges = (changes: EditChanges) => changes.added.length + changes.removed.length + changes.changed.length === 0;

const trimText = (edits: ReplayEdits) => (edits.trim ? formatRange(edits.trim.start, edits.trim.end) : 'none');

/** What a save changed, in words, item by item (matched by id): `+` added, `-` removed, `~` changed. */
export function diffEdits(before: ReplayEdits, after: ReplayEdits): EditChanges {
  const changes: EditChanges = { added: [], removed: [], changed: [] };
  for (const key of LIST_KEYS) {
    const old = new Map(itemsOf(before, key).map((item) => [item.id, item]));
    const next = new Map(itemsOf(after, key).map((item) => [item.id, item]));
    for (const [id, item] of next) {
      const was = old.get(id);
      if (!was) changes.added.push(`${ITEM_NAME[key]} ${describeItem(key, item)}`);
      else if (JSON.stringify(was) !== JSON.stringify(item))
        changes.changed.push(`${ITEM_NAME[key]} ${describeItem(key, was)} → ${describeItem(key, item)}`);
    }
    for (const [id, item] of old) if (!next.has(id)) changes.removed.push(`${ITEM_NAME[key]} ${describeItem(key, item)}`);
  }
  if (trimText(before) !== trimText(after)) changes.changed.push(`trim ${trimText(before)} → ${trimText(after)}`);
  const oldNames = before.stepNames ?? {};
  const newNames = after.stepNames ?? {};
  for (const [key, name] of Object.entries(newNames)) {
    if (oldNames[key] === undefined) changes.added.push(`step name at ${key} ms ${quoted(name)}`);
    else if (oldNames[key] !== name) changes.changed.push(`step name at ${key} ms ${quoted(oldNames[key])} → ${quoted(name)}`);
  }
  for (const [key, name] of Object.entries(oldNames))
    if (newNames[key] === undefined) changes.removed.push(`step name at ${key} ms ${quoted(name)}`);
  if (JSON.stringify(before.cursor ?? null) !== JSON.stringify(after.cursor ?? null))
    changes.changed.push(`cursor ${JSON.stringify(before.cursor ?? {})} → ${JSON.stringify(after.cursor ?? {})}`);
  return changes;
}

export function changeLines(changes: EditChanges): string[] {
  return [
    ...changes.added.map((line) => `+ ${line}`),
    ...changes.removed.map((line) => `- ${line}`),
    ...changes.changed.map((line) => `~ ${line}`),
  ];
}

/** The edit list as a numbered, per-kind listing (the numbers `cut rm`, `caption edit` and the others take). */
export function listEdits(edits: ReplayEdits): string[] {
  const lines: string[] = [];
  if (edits.trim) lines.push(`trim: keeps ${formatRange(edits.trim.start, edits.trim.end)}`);
  for (const key of LIST_KEYS) {
    const items = itemsOf(edits, key);
    if (!items.length) continue;
    lines.push(`${ITEM_NAME[key]}s:`);
    for (const [index, item] of items.entries()) lines.push(`  ${index + 1}  ${describeItem(key, item)}`);
  }
  const names = Object.keys(edits.stepNames ?? {}).length;
  if (names) lines.push(`renamed steps: ${names} (marked in the step list)`);
  if (edits.cursor) lines.push(`cursor: ${JSON.stringify(edits.cursor)}`);
  return lines.length ? lines : ['no edits yet'];
}

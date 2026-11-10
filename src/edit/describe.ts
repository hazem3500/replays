import type { ReplayEdits } from '../shared/edits.ts';
import { type EditItem, ITEM_NAME, itemsOf, LIST_KEYS, type ListKey } from './ops.ts';
import { formatRange, formatTime } from './time.ts';

const percent = (fraction: number) => `${Math.round(fraction * 1000) / 10}%`;
const quoted = (text: string) => `“${text}”`;
const labelled = (label: string | undefined) => (label ? ` ${quoted(label)}` : '');

function describeBlur(item: EditItem) {
  if (!('width' in item)) return '';
  const box = `x ${percent(item.x)} y ${percent(item.y)} w ${percent(item.width)} h ${percent(item.height)}`;
  return `${item.style === 'redact' ? 'removed' : 'blurred'} box ${box}`;
}

function describeZoom(item: EditItem) {
  if (!('scale' in item)) return '';
  return `${item.scale}×${item.x === undefined ? ' following clicks' : ` around ${percent(item.x)},${percent(item.y ?? 0.5)}`}`;
}

function detail(item: EditItem) {
  if ('rate' in item) return `at ${item.rate}×`;
  if ('scale' in item) return describeZoom(item);
  if ('width' in item) return describeBlur(item);
  if ('text' in item) return quoted(item.text);
  return labelled('label' in item ? item.label : undefined).trim();
}

/** One edit item in a line: its stretch of the original timeline and what it does there. */
export function describeItem(item: EditItem): string {
  if ('at' in item) return `at ${formatTime(item.at)}${labelled(item.label)}`;
  return `${formatRange(item.from, item.to)} ${detail(item)}`.trim();
}

export interface EditChanges {
  added: string[];
  removed: string[];
  changed: string[];
}

export const noChanges = (changes: EditChanges) => changes.added.length + changes.removed.length + changes.changed.length === 0;

const trimText = (edits: ReplayEdits) => (edits.trim ? formatRange(edits.trim.start, edits.trim.end) : 'none');

function diffList(key: ListKey, before: ReplayEdits, after: ReplayEdits, changes: EditChanges) {
  const name = ITEM_NAME[key];
  const old = new Map(itemsOf(before, key).map((item) => [item.id, item]));
  const next = new Map(itemsOf(after, key).map((item) => [item.id, item]));
  for (const [id, item] of next) {
    const was = old.get(id);
    if (!was) changes.added.push(`${name} ${describeItem(item)}`);
    else if (JSON.stringify(was) !== JSON.stringify(item)) changes.changed.push(`${name} ${describeItem(was)} → ${describeItem(item)}`);
  }
  for (const [id, item] of old) if (!next.has(id)) changes.removed.push(`${name} ${describeItem(item)}`);
}

function diffNames(before: ReplayEdits, after: ReplayEdits, changes: EditChanges) {
  const oldNames = before.stepNames ?? {};
  const newNames = after.stepNames ?? {};
  for (const [key, name] of Object.entries(newNames)) {
    const was = oldNames[key];
    if (was === undefined) changes.added.push(`step name at ${key} ms ${quoted(name)}`);
    else if (was !== name) changes.changed.push(`step name at ${key} ms ${quoted(was)} → ${quoted(name)}`);
  }
  for (const [key, name] of Object.entries(oldNames))
    if (newNames[key] === undefined) changes.removed.push(`step name at ${key} ms ${quoted(name)}`);
}

/** What a save changed, in words, item by item (matched by id): `+` added, `-` removed, `~` changed. */
export function diffEdits(before: ReplayEdits, after: ReplayEdits): EditChanges {
  const changes: EditChanges = { added: [], removed: [], changed: [] };
  for (const key of LIST_KEYS) diffList(key, before, after, changes);
  if (trimText(before) !== trimText(after)) changes.changed.push(`trim ${trimText(before)} → ${trimText(after)}`);
  diffNames(before, after, changes);
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
    for (const [index, item] of items.entries()) lines.push(`  ${index + 1}  ${describeItem(item)}`);
  }
  const names = Object.keys(edits.stepNames ?? {}).length;
  if (names) lines.push(`renamed steps: ${names} (marked in the step list)`);
  if (edits.cursor) lines.push(`cursor: ${JSON.stringify(edits.cursor)}`);
  return lines.length ? lines : ['no edits yet'];
}

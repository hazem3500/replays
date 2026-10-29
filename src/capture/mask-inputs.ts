import { isRecord } from '../shared/validate.ts';

const FULL_SNAPSHOT = 2;
const INCREMENTAL = 3;
const MUTATION = 0;
const INPUT = 5;
const ELEMENT = 2;
const TEXT = 3;

/**
 * rrweb `maskInputOptions` for the capture recorder: the `maskAllInputs` set (password is always in it) plus hidden inputs,
 * which often carry CSRF tokens and are never visible in a replay. `maskCapturedInputs` masks the same set.
 */
export const MASK_INPUT_OPTIONS: Record<string, true> = {
  color: true,
  date: true,
  'datetime-local': true,
  email: true,
  hidden: true,
  month: true,
  number: true,
  password: true,
  range: true,
  search: true,
  tel: true,
  text: true,
  time: true,
  url: true,
  week: true,
  textarea: true,
  select: true,
};
const MASKED_INPUT_TYPES = new Set(Object.keys(MASK_INPUT_OPTIONS));

/** Ids of masked inputs and of their text children, so later mutations of them stay masked. */
interface MaskedIds {
  inputs: Set<number>;
  texts: Set<number>;
}

const maskedInput = (value: string): string => '*'.repeat(value.length);
const records = (value: unknown): Array<Record<string, unknown>> => (Array.isArray(value) ? value.filter(isRecord) : []);
const attributesOf = (node: Record<string, unknown>): Record<string, unknown> | undefined =>
  isRecord(node.attributes) ? node.attributes : undefined;

function masksInput(tag: string, attributes: Record<string, unknown> | undefined): boolean {
  if (tag === 'textarea' || tag === 'select') return true;
  const type = typeof attributes?.type === 'string' && attributes.type ? attributes.type.toLowerCase() : 'text';
  return tag === 'input' && MASKED_INPUT_TYPES.has(type);
}

function maskElementTree(node: unknown, ids: MaskedIds): void {
  if (!isRecord(node)) return;
  const children: unknown[] = Array.isArray(node.childNodes) ? node.childNodes : [];
  if (node.type !== ELEMENT) {
    for (const child of children) maskElementTree(child, ids);
    return;
  }
  const attributes = attributesOf(node);
  const mask = masksInput(typeof node.tagName === 'string' ? node.tagName.toLowerCase() : '', attributes);
  if (mask && typeof node.id === 'number') ids.inputs.add(node.id);
  if (mask && attributes && typeof attributes.value === 'string') attributes.value = maskedInput(attributes.value);
  for (const child of children) {
    if (mask && isRecord(child) && child.type === TEXT && typeof child.id === 'number') {
      ids.texts.add(child.id);
      if (typeof child.textContent === 'string') child.textContent = maskedInput(child.textContent);
    }
    maskElementTree(child, ids);
  }
}

function maskMutation(data: Record<string, unknown>, ids: MaskedIds): void {
  for (const add of records(data.adds)) maskElementTree(add.node, ids);
  for (const removal of records(data.removes)) {
    if (typeof removal.id !== 'number') continue;
    ids.inputs.delete(removal.id);
    ids.texts.delete(removal.id);
  }
  for (const change of records(data.attributes)) {
    const attributes = attributesOf(change);
    if (typeof change.id === 'number' && ids.inputs.has(change.id) && typeof attributes?.value === 'string')
      attributes.value = maskedInput(attributes.value);
  }
  for (const change of records(data.texts)) {
    if (typeof change.id === 'number' && ids.texts.has(change.id) && typeof change.value === 'string') change.value = maskedInput(change.value);
  }
}

function maskEvent(event: unknown, ids: MaskedIds): void {
  if (!isRecord(event) || !isRecord(event.data)) return;
  const data = event.data;
  if (event.type === FULL_SNAPSHOT) {
    maskElementTree(data.node, ids);
    return;
  }
  if (event.type !== INCREMENTAL) return;
  if (data.source === INPUT && typeof data.text === 'string') data.text = maskedInput(data.text);
  else if (data.source === MUTATION) maskMutation(data, ids);
}

/**
 * Replaces input, textarea and select values the way rrweb's `maskAllInputs` does, so an imported recording cannot store
 * typed secrets the capture path would have masked. Button labels and other non-input text stay as recorded. Masks in
 * place and returns `events`.
 */
export function maskCapturedInputs<T>(events: T): T {
  if (!Array.isArray(events)) return events;
  const ids: MaskedIds = { inputs: new Set(), texts: new Set() };
  const list: unknown[] = events;
  for (const event of list) maskEvent(event, ids);
  return events;
}

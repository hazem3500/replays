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
/** invariant: masked whatever a bundle claims, the same pair the recorder keeps masked with `privacy.sanitize: false`. */
const ALWAYS_MASKED_INPUT_TYPES = new Set(['password', 'hidden']);
const FORM_FIELDS = new Set(['input', 'textarea', 'select']);

/**
 * Ids of masked inputs and of their text children, so later mutations of them stay masked, and of the form fields left
 * visible. `all` is the default `maskAllInputs` set; otherwise only `ALWAYS_MASKED_INPUT_TYPES`.
 */
interface MaskedIds {
  all: boolean;
  inputs: Set<number>;
  texts: Set<number>;
  visible: Set<number>;
}

const maskedInput = (value: string): string => '*'.repeat(value.length);
const records = (value: unknown): Array<Record<string, unknown>> => (Array.isArray(value) ? value.filter(isRecord) : []);
const attributesOf = (node: Record<string, unknown>): Record<string, unknown> | undefined =>
  isRecord(node.attributes) ? node.attributes : undefined;

function masksInput(tag: string, attributes: Record<string, unknown> | undefined, all: boolean): boolean {
  if (tag === 'textarea' || tag === 'select') return all;
  const type = typeof attributes?.type === 'string' && attributes.type ? attributes.type.toLowerCase() : 'text';
  return tag === 'input' && (all ? MASKED_INPUT_TYPES : ALWAYS_MASKED_INPUT_TYPES).has(type);
}

function maskElementTree(node: unknown, ids: MaskedIds): void {
  if (!isRecord(node)) return;
  const children: unknown[] = Array.isArray(node.childNodes) ? node.childNodes : [];
  if (node.type !== ELEMENT) {
    for (const child of children) maskElementTree(child, ids);
    return;
  }
  const mask = maskInputElement(node, ids);
  for (const child of children) {
    if (mask) maskInputText(child, ids);
    maskElementTree(child, ids);
  }
}

/** Masks an input, textarea or select element's value; true when the element is one. */
function maskInputElement(node: Record<string, unknown>, ids: MaskedIds): boolean {
  const attributes = attributesOf(node);
  const tag = typeof node.tagName === 'string' ? node.tagName.toLowerCase() : '';
  if (!masksInput(tag, attributes, ids.all)) {
    if (FORM_FIELDS.has(tag) && typeof node.id === 'number') ids.visible.add(node.id);
    return false;
  }
  if (typeof node.id === 'number') ids.inputs.add(node.id);
  if (attributes && typeof attributes.value === 'string') attributes.value = maskedInput(attributes.value);
  return true;
}

/** A text child of a masked input (a textarea's content) is masked and remembered for later text mutations. */
function maskInputText(child: unknown, ids: MaskedIds): void {
  if (!isRecord(child) || child.type !== TEXT || typeof child.id !== 'number') return;
  ids.texts.add(child.id);
  if (typeof child.textContent !== 'string') return;
  // oxlint-disable-next-line eslint/no-param-reassign -- why: masking is in place; the serialized node is the recording.
  child.textContent = maskedInput(child.textContent);
}

function maskMutation(data: Record<string, unknown>, ids: MaskedIds): void {
  for (const add of records(data.adds)) maskElementTree(add.node, ids);
  for (const removal of records(data.removes)) {
    if (typeof removal.id !== 'number') continue;
    ids.inputs.delete(removal.id);
    ids.texts.delete(removal.id);
    ids.visible.delete(removal.id);
  }
  for (const change of records(data.attributes)) {
    const attributes = attributesOf(change);
    if (typeof change.id !== 'number') continue;
    // invariant: a visible field that becomes a masked type (text to password) stays masked from then on.
    if (ids.visible.has(change.id) && attributes && Object.hasOwn(attributes, 'type') && masksInput('input', attributes, ids.all))
      ids.inputs.add(change.id);
    if (ids.inputs.has(change.id) && typeof attributes?.value === 'string') attributes.value = maskedInput(attributes.value);
  }
  for (const change of records(data.texts)) {
    if (typeof change.id === 'number' && ids.texts.has(change.id) && typeof change.value === 'string')
      change.value = maskedInput(change.value);
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
  if (data.source === INPUT && typeof data.text === 'string' && masksInputEvent(data.id, ids)) data.text = maskedInput(data.text);
  else if (data.source === MUTATION) maskMutation(data, ids);
}

/** invariant: with visible inputs kept, typing is kept only into a field known to be visible; an unknown id is masked. */
const masksInputEvent = (id: unknown, ids: MaskedIds): boolean =>
  ids.all || typeof id !== 'number' || !ids.visible.has(id) || ids.inputs.has(id);

/**
 * Replaces input, textarea and select values the way rrweb's `maskAllInputs` does, so an imported recording cannot store
 * typed secrets the capture path would have masked. Button labels and other non-input text stay as recorded. Masks in
 * place and returns `events`. `keepVisible` masks only password and hidden inputs, for a recording the server accepted as
 * captured with visible inputs (`meta.captured.inputs`).
 */
export function maskCapturedInputs<T>(events: T, { keepVisible = false }: { keepVisible?: boolean } = {}): T {
  if (!Array.isArray(events)) return events;
  const ids: MaskedIds = { all: !keepVisible, inputs: new Set(), texts: new Set(), visible: new Set() };
  const list: unknown[] = events;
  for (const event of list) maskEvent(event, ids);
  return events;
}

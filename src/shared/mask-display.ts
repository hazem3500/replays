/*
 * Masked form values are stored the way rrweb masks them: one `*` per character (src/capture/sanitize.ts).
 * For display, the replay shows them as password dots instead, so a masked field reads as "hidden", not as
 * literal asterisks. Only the copy handed to the replayer changes; stored bundles keep rrweb's form.
 */

const MASKED = /^\*+$/;
const DOT = '•';

const EVENT_FULL_SNAPSHOT = 2;
const EVENT_INCREMENTAL = 3;
const SOURCE_MUTATION = 0;
const SOURCE_INPUT = 5;

type Json = Record<string, unknown>;

function dots(value: unknown) {
  return typeof value === 'string' && MASKED.test(value) ? DOT.repeat(value.length) : value;
}

/** Rewrites `value` attributes in a serialized node tree, in place. */
function maskNode(node: Json | undefined) {
  if (!node) return;
  const attributes = node.attributes as Json | undefined;
  if (attributes && 'value' in attributes) attributes.value = dots(attributes.value);
  const children = node.childNodes as Json[] | undefined;
  if (children) for (const child of children) maskNode(child);
}

/** A copy of `events` whose masked input values render as dots. Events without masked values are shared, not cloned. */
export function withDottedMasks<T>(events: readonly T[]): T[] {
  return events.map((event) => {
    const e = event as Json;
    const data = e.data as Json | undefined;
    if (!data) return event;
    if (e.type === EVENT_FULL_SNAPSHOT) {
      if (!JSON.stringify(data).includes('"*')) return event;
      const copy = structuredClone(data);
      maskNode(copy.node as Json);
      return { ...e, data: copy } as T;
    }
    if (e.type !== EVENT_INCREMENTAL) return event;
    if (data.source === SOURCE_INPUT && typeof data.text === 'string' && MASKED.test(data.text)) {
      return { ...e, data: { ...data, text: dots(data.text) } } as T;
    }
    if (data.source === SOURCE_MUTATION && JSON.stringify(data).includes('"*')) {
      const copy = structuredClone(data);
      for (const add of (copy.adds as Json[] | undefined) ?? []) maskNode(add.node as Json);
      for (const change of (copy.attributes as Json[] | undefined) ?? []) {
        const attributes = change.attributes as Json | undefined;
        if (attributes && 'value' in attributes) attributes.value = dots(attributes.value);
      }
      return { ...e, data: copy } as T;
    }
    return event;
  });
}

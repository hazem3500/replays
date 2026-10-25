import type { FieldSchema } from '../config.ts';

/**
 * Turns a replay's `context.fields` (free-form JSON) and the deployment's optional JSON Schema for it into a
 * plain render tree, so the Context panel stays a dumb renderer and this stays unit-testable.
 */
export type FieldValue =
  /** Text, numbers and enums. */
  | { kind: 'text'; text: string }
  /** `format: "uri"` values that are https URLs; anything else stays text. */
  | { kind: 'link'; href: string; text: string }
  | { kind: 'boolean'; value: boolean; text: 'Yes' | 'No' }
  | { kind: 'chips'; items: string[] }
  /** `x-replays-widget: "signals"`: flags or permissions whose state may be unknown (not supplied, not loaded). */
  | { kind: 'signals'; items: Signal[] }
  | { kind: 'rows'; rows: FieldRow[] }
  | { kind: 'empty' };

export type SignalState = 'enabled' | 'disabled' | 'unknown';

export interface Signal {
  key: string;
  state: SignalState;
  label?: string;
}

const SIGNAL_STATES: readonly string[] = ['enabled', 'disabled', 'unknown'];

/** The entries as signals when every one is `{ key: string, state: enabled | disabled | unknown, label?: string }`. */
export function signalsOf(value: readonly unknown[]): Signal[] | undefined {
  const signals: Signal[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.key !== 'string' || !entry.key || !SIGNAL_STATES.includes(entry.state as string)) return undefined;
    signals.push({
      key: entry.key,
      state: entry.state as SignalState,
      ...(typeof entry.label === 'string' && entry.label ? { label: entry.label } : {}),
    });
  }
  return signals;
}

export interface FieldRow {
  key: string;
  label: string;
  /** The schema's `description`. */
  help?: string;
  value: FieldValue;
}

/** "billing_plan" / "billingPlan" / "billing-plan" -> "Billing plan". */
export function humanizeKey(key: string) {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : key;
}

/** The URL itself when it is an absolute https URL: the only kind of link the viewer renders. */
export function httpsHref(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isScalar = (value: unknown): value is string | number | boolean | null =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

function scalarText(value: unknown) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function fieldValue(value: unknown, schema: FieldSchema | undefined): FieldValue {
  if (value === null || value === undefined || value === '') return { kind: 'empty' };
  if (typeof value === 'boolean') return { kind: 'boolean', value, text: value ? 'Yes' : 'No' };
  if (typeof value === 'string' && schema?.format === 'uri') {
    const href = httpsHref(value);
    if (href) return { kind: 'link', href, text: value };
  }
  if (isScalar(value)) return { kind: 'text', text: scalarText(value) };
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: 'empty' };
    if (schema?.['x-replays-widget'] === 'signals') {
      const items = signalsOf(value);
      if (items) return { kind: 'signals', items };
    }
    if (value.every(isScalar)) return { kind: 'chips', items: value.map(scalarText) };
    return {
      kind: 'rows',
      rows: value.map((entry, index) => ({
        key: String(index),
        label: `#${index + 1}`,
        value: fieldValue(entry, schema?.items),
      })),
    };
  }
  if (isRecord(value)) return { kind: 'rows', rows: fieldRows(value, schema) };
  return { kind: 'text', text: String(value) };
}

/**
 * One row per key: the schema's properties first, in schema order, then keys the schema does not describe in
 * the object's own order; `x-replays-order` moves a property (lower first, default 0, ties keep that order). The
 * schema's `title` is the label (else the humanized key) and its `description` the help text. Keys the object lacks
 * are skipped.
 */
export function fieldRows(fields: Record<string, unknown>, schema?: FieldSchema): FieldRow[] {
  return orderedKeys(fields, schema).map((key) => fieldRow(key, fields[key], schema?.properties?.[key]));
}

export interface FieldGroup {
  /** `x-replays-group`; undefined for the properties without one (the Context tab titles those from the schema). */
  title?: string;
  rows: FieldRow[];
}

/**
 * The top-level rows split by `x-replays-group`: one group per name, placed where its first row comes, the ungrouped
 * rows forming one untitled group the same way.
 */
export function fieldGroups(fields: Record<string, unknown>, schema?: FieldSchema): FieldGroup[] {
  const groups: FieldGroup[] = [];
  const byTitle = new Map<string | undefined, FieldGroup>();
  for (const key of orderedKeys(fields, schema)) {
    const property = schema?.properties?.[key];
    const hint = property?.['x-replays-group'];
    const title = typeof hint === 'string' && hint.trim() ? hint.trim() : undefined;
    let group = byTitle.get(title);
    if (!group) {
      group = title === undefined ? { rows: [] } : { title, rows: [] };
      byTitle.set(title, group);
      groups.push(group);
    }
    group.rows.push(fieldRow(key, fields[key], property));
  }
  return groups;
}

function orderedKeys(fields: Record<string, unknown>, schema: FieldSchema | undefined) {
  const described = Object.keys(schema?.properties ?? {}).filter((key) => Object.hasOwn(fields, key));
  const extra = Object.keys(fields).filter((key) => !described.includes(key));
  const order = (key: string) => {
    const value = schema?.properties?.[key]?.['x-replays-order'];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  // A stable sort: equal orders keep schema-then-object order.
  return [...described, ...extra].sort((a, b) => order(a) - order(b));
}

function fieldRow(key: string, value: unknown, property: FieldSchema | undefined): FieldRow {
  return {
    key,
    label: property?.title || humanizeKey(key),
    ...(property?.description ? { help: property.description } : {}),
    value: fieldValue(value, property),
  };
}

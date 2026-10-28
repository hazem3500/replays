/** A field check for config validators: true when the value is acceptable. */
export type Check = (value: unknown) => boolean;
/** Field name → its check and the message that follows `<where>.<field>` when it fails. */
export type Checks = Readonly<Record<string, readonly [Check, string]>>;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const oneOf =
  (allowed: readonly unknown[]): Check =>
  (value) =>
    allowed.includes(value);

export const isBoolean: Check = (value) => typeof value === 'boolean';

/** A whole number from `min` to `max`. */
export const wholeNumber =
  (min: number, max: number): Check =>
  (value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/** A finite number from `min` to `max`. */
export const numberIn =
  (min: number, max: number): Check =>
  (value) =>
    typeof value === 'number' && value >= min && value <= max;

/** A list of at most `max` items that each pass `check`. */
export const listOf =
  (check: Check, max = Number.POSITIVE_INFINITY): Check =>
  (value) =>
    Array.isArray(value) && value.length <= max && value.every((item) => check(item));

/** Throws `<where> has unknown keys: …` for keys outside `allowed` and `extra`. */
export function assertKnownKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  where: string,
  extra: readonly string[] = [],
) {
  const unknown = Object.keys(record).filter((key) => !allowed.has(key) && !extra.includes(key));
  if (unknown.length) throw new Error(`${where} has unknown keys: ${unknown.join(', ')}`);
}

/** Runs each check on the fields that are set; the first failure throws `<where>.<field> <message>`. */
export function assertFields(record: Record<string, unknown>, checks: Checks, where: string) {
  for (const [key, [check, message]] of Object.entries(checks))
    if (record[key] !== undefined && !check(record[key])) throw new Error(`${where}.${key} ${message}`);
}

/** An object with only the keys in `checks` (plus `required`), each passing its check. */
export function assertShape(value: unknown, checks: Checks, where: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${where} must be an object`);
  assertKnownKeys(value, new Set(Object.keys(checks)), where);
  assertFields(value, checks, where);
}

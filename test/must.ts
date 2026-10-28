/** Narrows a lookup a test depends on, failing with a clear error instead of a later null dereference. */
export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected value to exist');
  return value;
}

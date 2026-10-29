/* why: the app's URLs keep their plain query strings (`?errors=1&sort=-duration`, `?t=12.5`, `?with=a,b`), the form the CLI
 * and agents print. The router's default would JSON-encode values (`q=%22a%22`);
 * these keep every value as text and leave out empty ones. Each route's schema (src/shared/schemas/search.ts) types
 * the text. Server-safe: no DOM.
 */

type Raw = Record<string, unknown>;

export function parseSearch(searchStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr))
    if (!(key in result)) result[key] = value;
  return result;
}

function asText(value: unknown) {
  if (value === true) return '1';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  return JSON.stringify(value) ?? '';
}

export function stringifySearch(search: Raw): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null || value === false || value === '') continue;
    params.set(key, asText(value));
  }
  // why: id lists (`?with=a,b`) stay readable, as the compare page writes them.
  const text = params.toString().replaceAll('%2C', ',');
  return text ? `?${text}` : '';
}

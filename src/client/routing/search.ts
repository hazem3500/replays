/*
 * The app's URLs keep their plain query strings (`?errors=1&sort=-duration`, `?t=12.5`), so links printed by the CLI,
 * agents and older builds open unchanged. The router's default would JSON-encode values (`errors=true`,
 * `q=%22a%22`); these keep every value as text, write `true` as `1`, and leave out empty ones. Each route's schema
 * (src/shared/schemas/search.ts) turns the text into typed values. Server-safe: no DOM.
 */

type Raw = Record<string, unknown>;

export function parseSearch(searchStr: string): Raw {
  const result: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr))
    if (!(key in result)) result[key] = value;
  return result;
}

export function stringifySearch(search: Raw): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null || value === false || value === '') continue;
    params.set(key, value === true ? '1' : String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

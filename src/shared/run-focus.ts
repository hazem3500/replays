/**
 * Focus markers: what a suite run's author wants the reviewer to look at in its recording, such as the request the
 * check depends on or the console error it reproduces. Each marker names a panel and a pattern; the viewer accents the
 * matching rows, counts them on the tab and marks them on the seek bar. They point, they do not filter what was
 * captured, and a marker that matches nothing is not an error (the recording may not have reached that request).
 */

export const FOCUS_PANELS = ['network', 'console', 'performance'] as const;
export type FocusPanel = (typeof FOCUS_PANELS)[number];

export interface FocusMarker {
  panel: FocusPanel;
  /**
   * Case-insensitive text the row must contain; `*` matches any run of characters. Network: an optional HTTP method
   * then part of the URL (`POST /api/v9/timer`). Console: part of the message. Performance: part of the moment's
   * name (`Click`, `Long task`, `button 'Save'`).
   */
  match: string;
  /** Why it matters, shown beside the row; plain text. */
  note?: string;
}

export const MAX_FOCUS_MARKERS = 20;
export const MAX_FOCUS_MATCH = 300;
export const MAX_FOCUS_NOTE = 200;

// oxlint-disable-next-line no-control-regex -- why: markers must be one line of plain text, so control characters are what this rejects.
const CONTROL = /[\u0000-\u001f\u007f]/;

function assertText(value: unknown, name: string, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || CONTROL.test(value)) {
    throw new Error(`${name} must be 1 to ${max} characters of plain text on one line`);
  }
}

const isPanel = (value: unknown): value is FocusPanel => FOCUS_PANELS.some((panel) => panel === value);

export function assertFocus(value: unknown, name: string): asserts value is FocusMarker[] {
  if (!Array.isArray(value) || value.length > MAX_FOCUS_MARKERS) throw new Error(`${name} must list at most ${MAX_FOCUS_MARKERS} markers`);
  const items: readonly unknown[] = value;
  for (const [index, raw] of items.entries()) {
    const where = `${name}[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${where} must be an object`);
    const marker: Record<string, unknown> = Object.fromEntries(Object.entries(raw));
    if (Object.keys(marker).some((key) => key !== 'panel' && key !== 'match' && key !== 'note')) {
      throw new Error(`${where} contains unsupported fields`);
    }
    if (!isPanel(marker.panel)) throw new Error(`${where}.panel must be one of ${FOCUS_PANELS.join(', ')}`);
    assertText(marker.match, `${where}.match`, MAX_FOCUS_MATCH);
    if (marker.note !== undefined) assertText(marker.note, `${where}.note`, MAX_FOCUS_NOTE);
  }
}

/** The note follows the pattern after ` # `, so a URL's own `#fragment` (no space before it) stays in the pattern. */
const NOTE_SEPARATOR = ' # ';

/** `network:POST /api/v9/timer # starts the timer` as a marker; throws with the expected shape otherwise. */
export function parseFocusSpec(spec: string): FocusMarker {
  const colon = spec.indexOf(':');
  const panel = spec.slice(0, colon).trim().toLowerCase();
  if (colon === -1 || !isPanel(panel)) {
    throw new Error(`focus "${spec}" must start with ${FOCUS_PANELS.map((item) => `${item}:`).join(', ')}`);
  }
  const rest = spec.slice(colon + 1);
  const split = rest.indexOf(NOTE_SEPARATOR);
  const match = (split === -1 ? rest : rest.slice(0, split)).trim();
  const note = split === -1 ? '' : rest.slice(split + NOTE_SEPARATOR.length).trim();
  const marker: FocusMarker = { panel, match, ...(note ? { note } : {}) };
  assertFocus([marker], 'focus');
  return marker;
}

/** The marker as `parseFocusSpec` reads it back. */
export function focusSpec(marker: FocusMarker) {
  return `${marker.panel}:${marker.match}${marker.note ? `${NOTE_SEPARATOR}${marker.note}` : ''}`;
}

const escape = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** A case-insensitive containment test with `*` as a wildcard. */
export function focusPattern(match: string): (text: string) => boolean {
  const pattern = new RegExp(match.trim().split('*').map(escape).join('.*'), 'is');
  return (text) => pattern.test(text);
}

const METHOD = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i;

/** One test per panel, built once per marker list: `test` answers the first marker a row matches. */
export interface FocusTests {
  network: (request: { method: string; url: string }) => FocusMarker | undefined;
  console: (entry: { message: string }) => FocusMarker | undefined;
  performance: (moment: { label: string }) => FocusMarker | undefined;
  /** Markers present at all, per panel. */
  has: Readonly<Record<FocusPanel, boolean>>;
}

export function focusTests(markers: readonly FocusMarker[] = []): FocusTests {
  const of = (panel: FocusPanel) => markers.filter((marker) => marker.panel === panel);
  const network = of('network').map((marker) => {
    const method = METHOD.exec(marker.match.trim());
    const test = focusPattern(method ? marker.match.trim().slice(method[0].length) : marker.match);
    const verb = method?.[1]?.toUpperCase();
    return {
      marker,
      test: (request: { method: string; url: string }) => (!verb || request.method.toUpperCase() === verb) && test(request.url),
    };
  });
  const text = (panel: FocusPanel) => of(panel).map((marker) => ({ marker, test: focusPattern(marker.match) }));
  const consoleTests = text('console');
  const performanceTests = text('performance');
  return {
    network: (request) => network.find((item) => item.test(request))?.marker,
    console: (entry) => consoleTests.find((item) => item.test(entry.message))?.marker,
    performance: (moment) => performanceTests.find((item) => item.test(moment.label))?.marker,
    has: { network: network.length > 0, console: consoleTests.length > 0, performance: performanceTests.length > 0 },
  };
}

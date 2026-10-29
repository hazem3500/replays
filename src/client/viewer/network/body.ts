import type { ReplayCaptured, ReplayNetworkBody } from '../../../shared/replay.ts';

export type BodyKind = 'json' | 'form' | 'text';

/** A body as the detail shows it: JSON indented, a form one field per line (decoded), anything else as captured. */
export interface BodyView {
  kind: BodyKind;
  text: string;
  lines: number;
}

const FORM = /^application\/x-www-form-urlencoded\b/i;
/** `a=1&b=2`: what a form body looks like, whatever content type the page sent with it. */
const FORM_SHAPE = /^[\w.%[\]-]+=[^&\s]*(?:&[\w.%[\]-]+=[^&\s]*)*$/;
const JSON_TYPE = /(?:^application\/json|\+json)\b/i;

function decode(value: string) {
  try {
    return decodeURIComponent(value.replaceAll('+', ' '));
  } catch {
    return value;
  }
}

function prettyJson(text: string): string | undefined {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // why: a body that does not parse (truncated, or not JSON after all) is shown as captured.
    return;
  }
}

/**
 * How to show a body's text. JSON is re-indented when it parses (a truncated body does not, and stays as captured);
 * a form body reads `name = value`, decoded, so a redacted field shows its marker instead of `%5Bredacted%5D`.
 */
export function bodyView(text: string, mimeType: string | undefined): BodyView {
  const mime = mimeType ?? '';
  const trimmed = text.trimStart();
  const json = JSON_TYPE.test(mime) || trimmed.startsWith('{') || trimmed.startsWith('[') ? prettyJson(text) : undefined;
  if (json !== undefined) return { kind: 'json', text: json, lines: json.split('\n').length };
  if (FORM.test(mime) || FORM_SHAPE.test(text)) {
    const fields = text
      .split('&')
      .filter(Boolean)
      .map((pair) => {
        const [name = '', ...rest] = pair.split('=');
        return `${decode(name)} = ${decode(rest.join('='))}`;
      });
    return { kind: 'form', text: fields.join('\n'), lines: fields.length };
  }
  return { kind: 'text', text, lines: text.split('\n').length };
}

/** The marker capture puts where a secret was, in any case, and as it reads inside a URL-encoded value. */
const REDACTION = /\[redacted\]|%5Bredacted%5D/gi;

export interface TextPart {
  text: string;
  redacted: boolean;
}

/** `text` cut into plain parts and redaction markers, so markers can be drawn as such. */
export function redactionParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(REDACTION)) {
    const at = match.index;
    if (at > cursor) parts.push({ text: text.slice(cursor, at), redacted: false });
    parts.push({ text: match[0], redacted: true });
    cursor = at + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), redacted: false });
  return parts;
}

export type BodyState =
  | { kind: 'shown'; body: ReplayNetworkBody & { text: string } }
  | { kind: 'empty' }
  | { kind: 'omitted'; reason: NonNullable<ReplayNetworkBody['omitted']> }
  | { kind: 'not-captured' };

/**
 * What a body section says, never a blank area: the text; "No body" when bodies were captured and this one had none;
 * why it was left out; or "Not captured" when the recording did not keep bodies (`meta.captured`).
 */
export function bodyState(body?: ReplayNetworkBody, captured?: ReplayCaptured): BodyState {
  if (body?.text !== undefined && body.text !== '') return { kind: 'shown', body: { ...body, text: body.text } };
  if (body?.omitted) return { kind: 'omitted', reason: body.omitted };
  if (body || captured?.network === 'bodies') return { kind: 'empty' };
  return { kind: 'not-captured' };
}

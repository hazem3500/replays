/* why: the recorder bundle may not import shared source, so these body rules are ported from
   src/shared/network-bodies.ts; test/recorder-body-parity.test.ts keeps both in step, and the ingest endpoint runs
   the shared pass again with the deployment's own rules. */
import { contentTypeAllowed, DEFAULT_BODY_LIMITS, type RecorderBodyLimits } from './body-limits.ts';
import type { ReplayNetworkBody } from './bundle-types.ts';

const REDACTED = '[redacted]';

const SECRET_FIELDS = new Set([
  'password',
  'passwd',
  'pwd',
  'passcode',
  'secret',
  'token',
  'auth',
  'authorization',
  'cookie',
  'setcookie',
  'session',
  'sessionid',
  'apikey',
  'privatekey',
  'secretkey',
  'accesskey',
  'credential',
  'credentials',
  'cardnumber',
  'ccnumber',
  'creditcard',
  'pan',
  'cvv',
  'cvc',
  'securitycode',
  'ssn',
  'iban',
  'otp',
  'pin',
]);
const SECRET_SUFFIX = /(?:token|secret|password|signature|apikey)$/;

function isSecretField(name: string) {
  const normalized = name.toLowerCase().replaceAll(/[-_\s]/g, '');
  return SECRET_FIELDS.has(normalized) || SECRET_SUFFIX.test(normalized);
}

const JWT = /\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g;
const BEARER = /\b(Bearer|Basic|Token)\s+[\w.~+/=-]{8,}/gi;
// why: bounded repeats keep a long run of word characters linear instead of backtracking quadratically.
const EMAIL = /\b[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}\b/g;
const DIGIT_RUN = /\b\d(?:[ -]?\d){12,18}\b/g;

function luhn(digits: string) {
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return sum % 10 === 0;
}

/** A Luhn-valid run of 13 to 19 digits, except a bare 13-digit epoch-milliseconds timestamp. */
function looksLikeCard(run: string) {
  const digits = run.replaceAll(/\D/g, '');
  if (digits === run && digits.length === 13 && digits.startsWith('1')) return false;
  return luhn(digits);
}

function redactSecretText(text: string, maskEmails: boolean) {
  let result = text.replace(JWT, REDACTED).replace(BEARER, (_match, scheme: string) => `${scheme} ${REDACTED}`);
  result = result.replace(DIGIT_RUN, (run) => (looksLikeCard(run) ? REDACTED : run));
  return maskEmails ? result.replace(EMAIL, REDACTED) : result;
}

function redactForm(text: string, maskEmails: boolean) {
  return text
    .split('&')
    .map((pair) => {
      const [name = '', ...rest] = pair.split('=');
      let decoded = name;
      try {
        decoded = decodeURIComponent(name.replaceAll('+', ' '));
      } catch {
        // why: a malformed escape is judged by its raw name.
      }
      if (!rest.length) return pair;
      return isSecretField(decoded) ? `${name}=${encodeURIComponent(REDACTED)}` : `${name}=${redactSecretText(rest.join('='), maskEmails)}`;
    })
    .join('&');
}

/** The end of the JSON value that starts at `start` (a string, an object or array, or a bare scalar). */
function jsonValueEnd(text: string, start: number): number {
  const first = text[start];
  if (first === '"') {
    for (let index = start + 1; index < text.length; index++) {
      if (text[index] === '\\') index++;
      else if (text[index] === '"') return index + 1;
    }
    return text.length;
  }
  if (first === '{' || first === '[') {
    let depth = 0;
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (char === '"') index = jsonValueEnd(text, index) - 1;
      else if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) return index + 1;
      }
    }
    return text.length;
  }
  const end = /[,}\]\s]/.exec(text.slice(start));
  return end ? start + end.index : text.length;
}

const JSON_KEY = /"((?:[^"\\]|\\.)*)"\s*:\s*/g;

/** Every secret field's value in JSON text (nested, and in cut-off JSON) becomes `"[redacted]"`. */
function redactJsonKeys(text: string) {
  if (!text.includes('"')) return text;
  let result = '';
  let last = 0;
  JSON_KEY.lastIndex = 0;
  for (let match = JSON_KEY.exec(text); match; match = JSON_KEY.exec(text)) {
    let key = match[1] ?? '';
    try {
      const decoded: unknown = JSON.parse(`"${key}"`);
      if (typeof decoded === 'string') key = decoded;
    } catch {
      // why: an invalid escape is judged by its raw key.
    }
    const valueStart = match.index + match[0].length;
    if (valueStart >= text.length || !isSecretField(key)) continue;
    const valueEnd = jsonValueEnd(text, valueStart);
    result += `${text.slice(last, valueStart)}"${REDACTED}"`;
    last = valueEnd;
    JSON_KEY.lastIndex = valueEnd;
  }
  return last ? result + text.slice(last) : text;
}

function redactBodyText(text: string, mimeType: string | undefined, maskEmails: boolean) {
  const form = contentTypeAllowed(mimeType, ['application/x-www-form-urlencoded']);
  return redactSecretText(form ? redactForm(text, maskEmails) : redactJsonKeys(text), maskEmails);
}

const encoder = new TextEncoder();

/** The first `maxBytes` bytes of `text` as text, never splitting a character. */
function cut(text: string, maxBytes: number) {
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return { text, size: bytes.length };
  let end = maxBytes;
  // why: a UTF-8 continuation byte (10xxxxxx) would leave half a character at the cut.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
  return { text: new TextDecoder().decode(bytes.subarray(0, end)), size: bytes.length, truncated: true as const };
}

export type BodyInput = {
  /** The body as the browser exposed it; `undefined` when it did not. */
  text: string | undefined;
  mimeType: string | undefined;
  /** The original size in bytes, when known. */
  size?: number | undefined;
};

/** A body as a replay keeps it: left out unless its content type is allowed, cut at `maxBytes`, then redacted. */
export function captureBody(input: BodyInput, limits: RecorderBodyLimits, maskEmails: boolean): ReplayNetworkBody {
  const maxBytes = Math.min(limits.maxBytes ?? DEFAULT_BODY_LIMITS.maxBytes, DEFAULT_BODY_LIMITS.maxBytes);
  const allowed = limits.contentTypes ?? DEFAULT_BODY_LIMITS.contentTypes;
  const size = input.size !== undefined && input.size >= 0 ? { size: input.size } : {};
  if (!contentTypeAllowed(input.mimeType, allowed)) return { omitted: 'content-type', ...size };
  if (input.text === undefined) return { omitted: 'unavailable', ...size };
  const kept = cut(input.text, maxBytes);
  return {
    text: redactBodyText(kept.text, input.mimeType, maskEmails),
    size: input.size ?? kept.size,
    ...(kept.truncated ? { truncated: true } : {}),
  };
}

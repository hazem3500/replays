import { contentTypeAllowed, DEFAULT_BODY_LIMITS, type NetworkBodyLimits } from './capture-profile.ts';
import { type CompiledRedaction, redactJsonKeys, redactText } from './redaction.ts';
import { isRecord } from './validate.ts';

/**
 * A captured request or response body, always redacted (secret fields, tokens, card numbers, email addresses, the
 * deployment's rules). `text` is absent when the body was left out; `omitted` says why.
 */
export interface ReplayNetworkBody {
  /** The kept text, redacted, at most the capture's `maxBytes` (UTF-8) before redaction. */
  text?: string;
  /** Bytes of the original body, when known. */
  size?: number;
  /** The text stops at `maxBytes`; the original was longer. */
  truncated?: true;
  /** Why there is no text: a content type outside the allowlist (binary included), or nothing the browser exposed. */
  omitted?: 'content-type' | 'unavailable';
}

/**
 * What a capture recorded, so a view can say "Not captured" instead of drawing an empty table. Absent on bundles from
 * before profiles: assume everything but bodies was captured.
 */
export interface ReplayCaptured {
  console: boolean;
  network: 'off' | 'headers' | 'bodies';
  performance: boolean;
  video: boolean;
}

/** What a captured body is replaced with, wherever a secret was found. */
export const REDACTED = '[redacted]';

/**
 * Field names whose values are always secret in a body, compared without case, `-` or `_`: exact names, plus any name
 * ending in token, secret, password, signature or apikey (`csrfToken`, `client_secret`, `X-Api-Key`).
 */
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

/** True when a body field with this name is secret. */
export function isSecretField(name: string): boolean {
  const normalized = name.toLowerCase().replaceAll(/[-_\s]/g, '');
  return SECRET_FIELDS.has(normalized) || SECRET_SUFFIX.test(normalized);
}

const JWT = /\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g;
const BEARER = /\b(Bearer|Basic|Token)\s+[\w.~+/=-]{8,}/gi;
// why: bounded repeats keep a long run of word characters linear instead of backtracking quadratically.
const EMAIL = /\b[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}\b/g;
const DIGIT_RUN = /\b\d(?:[ -]?\d){12,18}\b/g;

/** The Luhn checksum every payment card number passes; random digit runs mostly do not. */
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

/** Secrets that hide in free text: bearer credentials, JWTs, card numbers, email addresses (with `maskEmails`). */
function redactSecretText(text: string, maskEmails: boolean) {
  let result = text.replace(JWT, REDACTED).replace(BEARER, (_match, scheme: string) => `${scheme} ${REDACTED}`);
  result = result.replace(DIGIT_RUN, (run) => (looksLikeCard(run) ? REDACTED : run));
  return maskEmails ? result.replace(EMAIL, REDACTED) : result;
}

/** `a=1&password=x`: secret parameters replaced, values scanned like free text. */
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

export interface BodyRedaction {
  /** The deployment's rules (src/shared/redaction.ts): their JSON keys and text patterns apply on top. */
  rules: CompiledRedaction;
  /** Replace email addresses; on unless a capture says otherwise. */
  maskEmails?: boolean;
}

/**
 * A body's text with every secret replaced: secret fields in JSON (nested, and also in cut-off JSON), secret form
 * parameters, credentials, JWTs, card numbers and email addresses in any text, then the deployment's own rules.
 * Idempotent, so the server's privacy pass leaves an already-clean body unchanged.
 */
export function redactBodyText(text: string, mimeType: string | undefined, redaction: BodyRedaction): string {
  const maskEmails = redaction.maskEmails ?? true;
  const keys: CompiledRedaction = { ...redaction.rules, jsonKey: (name) => isSecretField(name) || redaction.rules.jsonKey(name) };
  const form = contentTypeAllowed(mimeType, ['application/x-www-form-urlencoded']);
  const structured = form ? redactForm(text, maskEmails) : redactJsonKeys(text, keys);
  return redactText(redactSecretText(structured, maskEmails), redaction.rules);
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

export interface BodyInput {
  /** The body as the browser exposed it; `undefined` when it did not. */
  text: string | undefined;
  /** `base64` for a binary body in a HAR. */
  encoding?: string | undefined;
  mimeType: string | undefined;
  /** The original size in bytes, when the source reports it. */
  size?: number | undefined;
}

/**
 * A body as a replay keeps it: left out unless its content type is allowed, cut at `maxBytes`, then redacted.
 * Binary bodies are never kept, whatever the type says.
 */
export function captureBody(input: BodyInput, limits: NetworkBodyLimits, redaction: BodyRedaction): ReplayNetworkBody {
  const maxBytes = Math.min(limits.maxBytes ?? DEFAULT_BODY_LIMITS.maxBytes, DEFAULT_BODY_LIMITS.maxBytes);
  const allowed = limits.contentTypes ?? DEFAULT_BODY_LIMITS.contentTypes;
  const size = input.size !== undefined && input.size >= 0 ? { size: input.size } : {};
  if (input.encoding === 'base64' || !contentTypeAllowed(input.mimeType, allowed)) return { omitted: 'content-type', ...size };
  if (input.text === undefined) return { omitted: 'unavailable', ...size };
  const kept = cut(input.text, maxBytes);
  return {
    text: redactBodyText(kept.text, input.mimeType, redaction),
    size: input.size ?? kept.size,
    ...(kept.truncated ? { truncated: true } : {}),
  };
}

/** The server's pass over an uploaded body: only the known fields, text redacted again, oversized text cut. */
export function sanitizeBody(body: unknown, mimeType: string | undefined, redaction: BodyRedaction): ReplayNetworkBody | undefined {
  if (!isRecord(body)) return undefined;
  const { text, size, truncated, omitted } = body;
  const clean: ReplayNetworkBody = {
    ...(typeof size === 'number' && Number.isInteger(size) && size >= 0 ? { size } : {}),
    ...(truncated === true ? { truncated: true } : {}),
    ...(omitted === 'content-type' || omitted === 'unavailable' ? { omitted } : {}),
  };
  if (typeof text !== 'string' || clean.omitted) return clean;
  const kept = cut(text, DEFAULT_BODY_LIMITS.maxBytes);
  return { ...clean, text: redactBodyText(kept.text, mimeType, redaction), ...(kept.truncated ? { truncated: true } : {}) };
}

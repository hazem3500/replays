import type { ReplayCaptured } from './network-bodies.ts';
import type { ConsoleLevel } from './replay.ts';
import { assertShape, type Check, type Checks, isBoolean, isRecord, listOf, numberIn, oneOf, wholeNumber } from './validate.ts';

/**
 * How much of the network a capture keeps: nothing, the request and response lines and headers (the default), or
 * also the bodies. Bodies are opt-in only, and always pass the same redaction as headers and URLs.
 */
export type CaptureNetwork = 'off' | 'headers' | 'bodies';
export const CAPTURE_NETWORK: readonly CaptureNetwork[] = ['off', 'headers', 'bodies'];

/** How a recording captured input values (`meta.captured.inputs`); absent means masked. */
export type CapturedInputs = 'masked' | 'visible';
export const CAPTURED_INPUTS: readonly CapturedInputs[] = ['masked', 'visible'];

/**
 * A recorder masking mode. `interface-visible` masks every text but the product interface marked `data-replay-public`
 * (never form fields); `text-masked` masks text and inputs but shows media; `masked` hides all three.
 */
export type CapturedMode = 'masked' | 'interface-visible' | 'text-masked' | 'visible';
export const CAPTURED_MODES: readonly CapturedMode[] = ['masked', 'interface-visible', 'text-masked', 'visible'];

/**
 * What a customer picked in a recording's options step (`meta.captured.choice`): the `mode`, so the server knows which
 * text rules applied; whether it shows typed values and page text once the host's cap applied (`inputs`, `text`); and
 * whether they asked for request and response content (`bodies`). Only a claim: the server keeps what it allows for a
 * host with `privacy.keepCustomerChoices`, and masks the rest.
 */
export interface CapturedChoice {
  by: 'customer';
  mode: CapturedMode;
  inputs: CapturedInputs;
  text: CapturedInputs;
  bodies: boolean;
}

/** rrweb sampling: every mouse move and scroll (`full`), the recorder's defaults (`balanced`), or fewer (`light`). */
export type CaptureSampling = 'full' | 'balanced' | 'light';
export const CAPTURE_SAMPLING: readonly CaptureSampling[] = ['full', 'balanced', 'light'];

/** Limits for captured bodies; each one can only be lowered from the defaults (DEFAULT_BODY_LIMITS). */
export interface NetworkBodyLimits {
  /** Bytes kept per body before it is cut with a truncation marker. */
  maxBytes?: number;
  /** MIME types (`application/json`) or families (`text/*`) whose bodies are kept; others are recorded as not captured. */
  contentTypes?: readonly string[];
}

/**
 * A profile's capture defaults, read by `replays capture --profile <id>` and the recorder kit; explicit flags and
 * options win. invariant: a profile can only tighten privacy. Loosening stays in redaction config and recorder
 * privacy options, and bodies stay off unless asked for.
 */
export interface CaptureProfile {
  /** Console levels kept; default all. An empty list keeps no console track. */
  console?: readonly ConsoleLevel[];
  /** Default `'headers'`. */
  network?: CaptureNetwork;
  /** Body limits when `network` is `'bodies'`. */
  bodies?: NetworkBodyLimits;
  /** Performance entries (paint, LCP, long tasks, slow interactions); default true. */
  performance?: boolean;
  /** Default `'balanced'`. */
  sampling?: CaptureSampling;
  /** CLI: also write session.mp4. */
  video?: boolean;
  /** CLI: hold after each non-wait action, 0 to 10000 ms. */
  stepPauseMs?: number;
  viewport?: { width: number; height: number };
  /** CLI: record this many runs into one suite, 1 to 10. */
  runs?: number;
  /** Stricter masking than the deployment's; `true` is the only accepted value. */
  privacy?: { maskAllText?: true; blockMedia?: true };
}

/** Body limits when a capture asks for bodies and says nothing else: 64 KiB of JSON, text or form data. */
export const DEFAULT_BODY_LIMITS: Required<NetworkBodyLimits> = {
  maxBytes: 64 * 1024,
  contentTypes: ['application/json', 'application/*+json', 'text/*', 'application/x-www-form-urlencoded'],
};

const LEVELS: readonly ConsoleLevel[] = ['debug', 'info', 'log', 'warn', 'error'];
const MIME = /^[a-z]+\/(?:\*|[a-z0-9.+-]+|\*\+[a-z0-9.-]+)$/;

/** A MIME pattern the defaults already allow, so a profile's list can only narrow them. */
const narrowsDefaults: Check = (type) =>
  typeof type === 'string' && MIME.test(type) && contentTypeAllowed(type.replace('*', 'x'), DEFAULT_BODY_LIMITS.contentTypes);

const BODY_CHECKS: Checks = {
  maxBytes: [wholeNumber(0, DEFAULT_BODY_LIMITS.maxBytes), `must be a whole number of bytes from 0 to ${DEFAULT_BODY_LIMITS.maxBytes}`],
  contentTypes: [listOf(narrowsDefaults), `can only narrow the defaults (${DEFAULT_BODY_LIMITS.contentTypes.join(', ')})`],
};

const isViewport: Check = (value) =>
  isRecord(value) && [value.width, value.height].every(wholeNumber(100, 10_000)) && Object.keys(value).length === 2;
const tightensPrivacy: Check = (value) =>
  isRecord(value) && Object.entries(value).every(([key, flag]) => (key === 'maskAllText' || key === 'blockMedia') && flag === true);

const PROFILE_CHECKS: Checks = {
  console: [listOf(oneOf(LEVELS)), `must list levels from ${LEVELS.join(', ')}`],
  network: [oneOf(CAPTURE_NETWORK), `must be one of ${CAPTURE_NETWORK.join(', ')}`],
  bodies: [isRecord, 'must be an object { maxBytes?, contentTypes? }'],
  performance: [isBoolean, 'must be a boolean'],
  sampling: [oneOf(CAPTURE_SAMPLING), `must be one of ${CAPTURE_SAMPLING.join(', ')}`],
  video: [isBoolean, 'must be a boolean'],
  stepPauseMs: [numberIn(0, 10_000), 'must be a number of milliseconds from 0 to 10000'],
  viewport: [isViewport, 'must be { width, height } in whole pixels from 100 to 10000'],
  runs: [wholeNumber(1, 10), 'must be a whole number from 1 to 10'],
  privacy: [tightensPrivacy, 'can only tighten: maskAllText: true and blockMedia: true'],
};

/** Throws a readable error unless `value` is a well-formed capture profile that tightens privacy only. */
export function assertCaptureProfile(value: unknown, where = 'capture'): asserts value is CaptureProfile {
  assertShape(value, PROFILE_CHECKS, where);
  if (value.bodies === undefined) return;
  if (value.network !== 'bodies') throw new Error(`${where}.bodies only applies with network: "bodies"`);
  assertShape(value.bodies, BODY_CHECKS, `${where}.bodies`);
}

/** True when `mimeType` (parameters ignored) matches one of `allowed` (`text/*`, `application/*+json`, exact). */
export function contentTypeAllowed(mimeType: string | undefined, allowed: readonly string[]): boolean {
  const type = mimeType?.split(';')[0]?.trim().toLowerCase();
  if (!type) return false;
  const [family, subtype = ''] = type.split('/');
  return allowed.some((pattern) => {
    if (pattern === type) return true;
    const [allowedFamily, allowedSubtype = ''] = pattern.split('/');
    if (allowedFamily !== family) return false;
    if (allowedSubtype === '*') return true;
    return allowedSubtype.startsWith('*+') && subtype.endsWith(allowedSubtype.slice(1));
  });
}

const CAPTURED_CHECKS: Checks = {
  console: [isBoolean, 'must be a boolean'],
  network: [oneOf(CAPTURE_NETWORK), `must be one of ${CAPTURE_NETWORK.join(', ')}`],
  performance: [isBoolean, 'must be a boolean'],
  video: [isBoolean, 'must be a boolean'],
  inputs: [oneOf(CAPTURED_INPUTS), `must be one of ${CAPTURED_INPUTS.join(', ')}`],
  choice: [isRecord, 'must be an object'],
};
const OPTIONAL_CAPTURED = new Set(['inputs', 'choice']);
const CHOICE_CHECKS: Checks = {
  by: [oneOf(['customer']), 'must be customer'],
  mode: [oneOf(CAPTURED_MODES), `must be one of ${CAPTURED_MODES.join(', ')}`],
  inputs: [oneOf(CAPTURED_INPUTS), `must be one of ${CAPTURED_INPUTS.join(', ')}`],
  text: [oneOf(CAPTURED_INPUTS), `must be one of ${CAPTURED_INPUTS.join(', ')}`],
  bodies: [isBoolean, 'must be a boolean'],
};

/** Throws unless `value` is a complete `meta.captured` record. */
export function assertCaptured(value: unknown, where = 'captured'): asserts value is ReplayCaptured {
  assertShape(value, CAPTURED_CHECKS, where);
  const missing = Object.keys(CAPTURED_CHECKS).filter((key) => !OPTIONAL_CAPTURED.has(key) && value[key] === undefined);
  if (missing.length) throw new Error(`${where} is missing ${missing.join(', ')}`);
  if (value.choice === undefined) return;
  const choice = value.choice;
  assertShape(choice, CHOICE_CHECKS, `${where}.choice`);
  const unset = Object.keys(CHOICE_CHECKS).filter((key) => choice[key] === undefined);
  if (unset.length) throw new Error(`${where}.choice is missing ${unset.join(', ')}`);
}

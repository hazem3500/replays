/**
 * The first-party upload handoff: a browser that blocks third-party cookies never sends the Replays session with a
 * cross-site `fetch`, so the recorder opens `GET /upload` in a window of its own and passes the bundle by `postMessage`.
 * The page uploads it as a same-site request, then posts the receipt back. Every message names its sender and carries the
 * handoff `id` the recorder chose, and each side checks `event.origin` and `event.source` before it acts.
 */

/** Public path of the handoff page, base-stripped. */
export const HANDOFF_PATH = '/upload';
export const HANDOFF_CHANNEL = 'replays-upload-handoff';
export const HANDOFF_VERSION = 1;
/** Most JSON characters the page accepts; `POST /api/replays` refuses a larger body in any case. */
export const MAX_HANDOFF_CHARS = 64 * 1024 * 1024;

/** Page to recorder: loaded and ready for the bundle. Carries no secret, so it may go to any opener. */
export type HandoffReady = { channel: typeof HANDOFF_CHANNEL; version: typeof HANDOFF_VERSION; type: 'ready' };
/** Recorder to page: the bundle, as the JSON text that `POST /api/replays` takes. */
export type HandoffBundle = {
  channel: typeof HANDOFF_CHANNEL;
  version: typeof HANDOFF_VERSION;
  type: 'bundle';
  id: string;
  payload: string;
};
/** Page to recorder: what Replays answered. */
export type HandoffReceipt = {
  channel: typeof HANDOFF_CHANNEL;
  version: typeof HANDOFF_VERSION;
  type: 'receipt';
  id: string;
  ok: true;
  replayId: string;
  url?: string;
};
export type HandoffFailure = {
  channel: typeof HANDOFF_CHANNEL;
  version: typeof HANDOFF_VERSION;
  type: 'receipt';
  id: string;
  ok: false;
  /** The HTTP status, or 0 when the request never got an answer. */
  status: number;
};
export type HandoffMessage = HandoffReady | HandoffBundle | HandoffReceipt | HandoffFailure;

const REPLAY_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const HANDOFF_ID = /^[A-Za-z0-9-]{16,64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A well-formed handoff message of one of `types`, or undefined. It checks shape only; the caller checks the origin first. */
export function parseHandoffMessage<Type extends HandoffMessage['type']>(
  data: unknown,
  types: readonly Type[],
): Extract<HandoffMessage, { type: Type }> | undefined {
  if (!isRecord(data) || data.channel !== HANDOFF_CHANNEL || data.version !== HANDOFF_VERSION) return undefined;
  if (!types.includes(data.type as Type)) return undefined;
  if (data.type === 'ready') return data as Extract<HandoffMessage, { type: Type }>;
  if (typeof data.id !== 'string' || !HANDOFF_ID.test(data.id)) return undefined;
  if (data.type === 'bundle') {
    if (typeof data.payload !== 'string' || data.payload.length === 0 || data.payload.length > MAX_HANDOFF_CHARS) return undefined;
    return data as Extract<HandoffMessage, { type: Type }>;
  }
  if (data.ok === true) {
    if (typeof data.replayId !== 'string' || !REPLAY_ID.test(data.replayId)) return undefined;
    if (data.url !== undefined && (typeof data.url !== 'string' || !data.url.startsWith('/'))) return undefined;
    return data as Extract<HandoffMessage, { type: Type }>;
  }
  if (data.ok === false && Number.isInteger(data.status)) return data as Extract<HandoffMessage, { type: Type }>;
  return undefined;
}

export const newHandoffId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** What the server embeds in the page: the origins allowed to hand over a bundle (the `/api/replays` request policy). */
export type HandoffAllowlist = { origins: string[]; originPatterns: string[] };

/** True for an exact origin or a host pattern the policy lists. Patterns are validated host shapes, never free-form. */
export function handoffOriginAllowed(allowlist: HandoffAllowlist, origin: string): boolean {
  if (allowlist.origins.includes(origin)) return true;
  return allowlist.originPatterns.some((pattern) => new RegExp(pattern).test(origin));
}

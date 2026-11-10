/** Messages of the first-party upload handoff (see `src/shared/upload-handoff.ts` for the server half). */
export const HANDOFF_PATH = '/upload';
export const HANDOFF_CHANNEL = 'replays-upload-handoff';
export const HANDOFF_VERSION = 1;
export const MAX_HANDOFF_CHARS = 64 * 1024 * 1024;

type Envelope = { channel: typeof HANDOFF_CHANNEL; version: typeof HANDOFF_VERSION };

/** Page to recorder: loaded and ready for the bundle. Carries no secret, so it may go to any opener. */
export type HandoffReady = Envelope & { type: 'ready' };
/** Recorder to page: the bundle, as the JSON text that `POST /api/replays` takes. */
export type HandoffBundle = Envelope & { type: 'bundle'; id: string; payload: string };
/** Page to recorder: what Replays answered. */
export type HandoffReceipt = Envelope & { type: 'receipt'; id: string; ok: true; replayId: string; url?: string };
/** `status` is the HTTP status, or 0 when the request never got an answer. */
export type HandoffFailure = Envelope & { type: 'receipt'; id: string; ok: false; status: number };
export type HandoffMessage = HandoffReady | HandoffBundle | HandoffReceipt | HandoffFailure;

const REPLAY_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const HANDOFF_ID = /^[A-Za-z0-9-]{16,64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const validBundle = (data: Record<string, unknown>) =>
  typeof data.payload === 'string' && data.payload.length > 0 && data.payload.length <= MAX_HANDOFF_CHARS;

function validReceipt(data: Record<string, unknown>) {
  if (data.ok === false) return Number.isInteger(data.status);
  if (data.ok !== true || typeof data.replayId !== 'string' || !REPLAY_ID.test(data.replayId)) return false;
  return data.url === undefined || (typeof data.url === 'string' && data.url.startsWith('/'));
}

/** A well-formed handoff message of one of `types`, or undefined. It checks shape only; the caller checks the origin first. */
export function parseHandoffMessage<Type extends HandoffMessage['type']>(
  data: unknown,
  types: readonly Type[],
): Extract<HandoffMessage, { type: Type }> | undefined {
  if (!isRecord(data) || data.channel !== HANDOFF_CHANNEL || data.version !== HANDOFF_VERSION) return undefined;
  if (!types.includes(data.type as Type)) return undefined;
  const shape =
    data.type === 'ready' ||
    (typeof data.id === 'string' && HANDOFF_ID.test(data.id) && (data.type === 'bundle' ? validBundle(data) : validReceipt(data)));
  return shape ? (data as Extract<HandoffMessage, { type: Type }>) : undefined;
}

export const newHandoffId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');

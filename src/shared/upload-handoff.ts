/**
 * The first-party upload handoff: a browser that blocks third-party cookies never sends the Replays session with a
 * cross-site `fetch`, so the recorder opens `GET /upload` (base-stripped path) in a window of its own and passes the bundle
 * by `postMessage`; the page uploads it same-site and posts the receipt back. The recorder's half of the protocol lives
 * in `src/recorder/handoff-protocol.ts`, which a test keeps in step with these values.
 */
export const HANDOFF_PATH = '/upload';
export const HANDOFF_CHANNEL = 'replays-upload-handoff';
export const HANDOFF_VERSION = 1;
/** Most JSON characters the page accepts; `POST /api/replays` refuses a larger body in any case. */
export const MAX_HANDOFF_CHARS = 64 * 1024 * 1024;

/** What the server embeds in the page: the origins allowed to hand over a bundle (the `/api/replays` request policy). */
export type HandoffAllowlist = { origins: string[]; originPatterns: string[] };

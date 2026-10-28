import { delay, http, HttpResponse } from 'msw';
import { assertReplayBundle, type ReplayBundle } from '../../src/shared/replay.ts';

/** How the mocked ingest endpoint answers: at once, only when released, or with a retryable 503. */
export type EndpointMode = 'accept' | 'hold' | 'unavailable';

/** The parts of an issue report a server checks: a valid replay bundle and the reporter's note. */
export type ReceivedReport = { bundle: ReplayBundle; note?: string };

export type ReceivedUpload = {
  id: number;
  contentEncoding: string | null;
  authorization: string | null;
  wireBytes: number;
  report: ReceivedReport;
  body: string;
};

const noop = () => {};

export const UPLOAD_PATH = '/storybook/ingest/replays';
export const RECEIPT = { id: 'storybook-demo-42', reference: 'SB-1042', replayUrl: 'https://replays.example/r/storybook-demo-42' };

function parseReport(body: string): ReceivedReport {
  const value: unknown = JSON.parse(body);
  if (typeof value !== 'object' || value === null || !('bundle' in value)) throw new Error('The upload is not an issue report');
  const { bundle } = value;
  assertReplayBundle(bundle);
  const note = 'note' in value && typeof value.note === 'string' ? value.note : undefined;
  return { bundle, ...(note === undefined ? {} : { note }) };
}

async function readBody(request: Request) {
  const raw = await request.arrayBuffer();
  const gzipped = request.headers.get('content-encoding') === 'gzip';
  const body = gzipped
    ? await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(raw);
  return { raw, body };
}

/**
 * A replay ingest endpoint behind the Mock Service Worker. The recorder's real transport posts to it over the network,
 * so the story sees the exact bytes a server would: gzip encoding, headers and the report JSON.
 */
export function createUploadEndpoint(initial: EndpointMode) {
  let mode = initial;
  let release = noop;
  let held = Promise.resolve();
  let uploads: readonly ReceivedUpload[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const setMode = (next: EndpointMode) => {
    mode = next;
    if (next === 'hold') held = new Promise<void>((resolve) => (release = resolve));
  };
  setMode(initial);
  const handler = http.post(`*${UPLOAD_PATH}`, async ({ request }) => {
    const { raw, body } = await readBody(request);
    const report = parseReport(body);
    const received = {
      id: uploads.length,
      contentEncoding: request.headers.get('content-encoding'),
      authorization: request.headers.get('authorization'),
      wireBytes: raw.byteLength,
      report,
      body,
    };
    uploads = [...uploads, received];
    notify();
    if (mode === 'hold') await held;
    if (mode === 'unavailable') return HttpResponse.json({ error: 'Ingest is unavailable' }, { status: 503 });
    await delay(150);
    return HttpResponse.json(RECEIPT, { status: 201 });
  });
  return {
    handler,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    uploads: () => uploads,
    setMode,
    release: () => release(),
    reset: () => {
      uploads = [];
      setMode(initial);
      notify();
    },
  };
}

export type UploadEndpoint = ReturnType<typeof createUploadEndpoint>;

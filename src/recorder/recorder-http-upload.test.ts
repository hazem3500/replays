// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

import { createRecorder } from './recorder.ts';
import { createFakeRrweb } from './testing/fakes.ts';

describe('createRecorder with HTTP upload options', () => {
  it('uploads through HTTP options in place of a transport function', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: 'stored-1', replayUrl: 'https://replays.example.com/r/stored-1' }), { status: 201 }),
      ),
    );
    const recorder = createRecorder({
      upload: { url: 'https://ingest.example.com/api/recordings', headers: { 'x-app-key': 'key-1' }, fetch },
      loadRrweb: createFakeRrweb().load,
    });
    await recorder.start({ consent: true });
    recorder.stop();
    expect(await recorder.upload({ confirmed: true })).toEqual({ replayId: 'stored-1', url: 'https://replays.example.com/r/stored-1' });
  });
});

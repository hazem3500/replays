// @vitest-environment happy-dom
// @vitest-environment-options {"url": "http://localhost/"}
import { afterEach, describe, expect, it } from 'vitest';

import { probePreview, resetPreviews } from '../src/client/index/Poster.tsx';
import { previewProbe } from './msw/handlers.ts';
import { setupMockApi } from './msw/server.ts';

const { mock } = setupMockApi();

afterEach(() => {
  resetPreviews();
});

describe('hover preview readiness', () => {
  it('waits for a rendering 202 response before treating the clip as playable', async () => {
    mock(
      previewProbe(
        { status: 202, headers: { 'retry-after': '2' } },
        { status: 200, headers: { 'x-preview-covers-ms': '12000', 'x-preview-speed': '3' } },
      ),
    );
    expect(await probePreview('checkout')).toEqual({ status: 'pending', retryMs: 2000 });
    expect(await probePreview('checkout')).toEqual({ status: 'ready', capped: false, coversMs: 12000, speed: 3 });
  });

  it('keeps retryable unavailable responses pending', async () => {
    mock(previewProbe({ status: 503, headers: { 'retry-after': '4' } }));
    expect(await probePreview('checkout')).toEqual({ status: 'pending', retryMs: 4000 });
  });
});

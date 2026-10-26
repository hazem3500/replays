// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { probePreview, resetPreviews } from '../src/client/index/Poster.tsx';

afterEach(() => {
  resetPreviews();
  vi.unstubAllGlobals();
});

describe('hover preview readiness', () => {
  it('waits for a rendering 202 response before treating the clip as playable', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 202, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { 'x-preview-covers-ms': '12000', 'x-preview-speed': '3' } }));
    vi.stubGlobal('fetch', request);

    // Accepted/rendering responses are successful HTTP responses, but have no video bytes yet.
    expect(new Response(null, { status: 202 }).ok).toBe(true);
    expect(await probePreview('checkout')).toEqual({ status: 'pending', retryMs: 2000 });
    expect(await probePreview('checkout')).toEqual({ status: 'ready', capped: false, coversMs: 12000, speed: 3 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[1]).toEqual({ method: 'HEAD' });
  });

  it('keeps retryable unavailable responses pending', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503, headers: { 'retry-after': '4' } })));
    expect(await probePreview('checkout')).toEqual({ status: 'pending', retryMs: 4000 });
  });
});

import type { ReplayBundle } from '@hazem3500/replays/model';

export function composedRecording(id: string, title: string): ReplayBundle {
  return {
    meta: {
      id,
      title,
      url: 'https://example.com/checkout',
      capturedAt: '2026-11-02T00:00:00.000Z',
      duration: 8000,
      viewport: { width: 800, height: 600 },
      eventCount: 3,
      version: 1,
    },
    events: [
      { type: 4, timestamp: 1000, data: { href: 'https://example.com/checkout', width: 800, height: 600 } },
      {
        type: 2,
        timestamp: 1000,
        data: {
          node: {
            type: 0,
            id: 1,
            childNodes: [
              {
                type: 2,
                id: 2,
                tagName: 'html',
                attributes: {},
                childNodes: [
                  { type: 2, id: 3, tagName: 'head', attributes: {}, childNodes: [] },
                  { type: 2, id: 4, tagName: 'body', attributes: {}, childNodes: [{ type: 3, id: 5, textContent: title }] },
                ],
              },
            ],
          },
          initialOffset: { top: 0, left: 0 },
        },
      },
      {
        type: 3,
        timestamp: 9000,
        data: { source: 0, texts: [{ id: 5, value: `${title} finished` }], attributes: [], removes: [], adds: [] },
      },
    ],
    steps: [
      { at: 0, kind: 'open', label: `${title} opened` },
      { at: 2000, kind: 'click', label: `${title} review` },
    ],
    console: [{ at: 3500, level: 'error', message: `${title} payment failed` }],
    network: [
      {
        id: `${id}-request`,
        at: 4000,
        duration: 180,
        method: 'POST',
        url: 'https://example.com/payment',
        status: 503,
        statusText: 'Unavailable',
        requestHeaders: [],
        responseHeaders: [],
      },
    ],
  };
}

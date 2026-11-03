import type { ReplayBundle } from '../../src/shared/replay.ts';

export function compositionRecording(title: string, diagnostics = true): ReplayBundle {
  return {
    meta: {
      id: title.toLowerCase().replaceAll(' ', '-'),
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
    steps: diagnostics
      ? [
          { at: 0, kind: 'open', label: 'Open checkout' },
          { at: 2000, kind: 'click', label: 'Review order' },
        ]
      : [],
    console: diagnostics ? [{ at: 3500, level: 'error', message: 'Payment declined' }] : [],
    network: [],
  };
}

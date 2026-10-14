import { describe, expect, it } from 'vitest';

import { withDottedMasks } from '../src/shared/mask-display.ts';

describe('withDottedMasks', () => {
  it('shows masked snapshot values, input events and mutations as dots', () => {
    const events = [
      {
        type: 2,
        timestamp: 1,
        data: { node: { type: 0, childNodes: [{ type: 2, tagName: 'input', attributes: { value: '****' }, childNodes: [] }] } },
      },
      { type: 3, timestamp: 2, data: { source: 5, id: 3, text: '******' } },
      {
        type: 3,
        timestamp: 3,
        data: {
          source: 0,
          adds: [{ node: { type: 2, attributes: { value: '**' } } }],
          attributes: [{ id: 4, attributes: { value: '***' } }],
          removes: [],
          texts: [],
        },
      },
    ];
    const out = withDottedMasks(events) as typeof events;
    expect((out[0]!.data as { node: { childNodes: Array<{ attributes: { value: string } }> } }).node.childNodes[0]!.attributes.value).toBe(
      '••••',
    );
    expect((out[1]!.data as { text: string }).text).toBe('••••••');
    const mutation = out[2]!.data as {
      adds: Array<{ node: { attributes: { value: string } } }>;
      attributes: Array<{ attributes: { value: string } }>;
    };
    expect(mutation.adds[0]!.node.attributes.value).toBe('••');
    expect(mutation.attributes[0]!.attributes.value).toBe('•••');
    // The stored events are untouched.
    expect((events[1]!.data as { text: string }).text).toBe('******');
  });

  it('leaves real values and unmasked events alone', () => {
    const events = [
      { type: 3, timestamp: 2, data: { source: 5, id: 3, text: 'a*b' } },
      { type: 4, timestamp: 0, data: { href: 'x' } },
    ];
    const out = withDottedMasks(events);
    expect(out[0]).toBe(events[0]);
    expect(out[1]).toBe(events[1]);
  });
});

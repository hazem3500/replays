import { describe, expect, it } from 'vitest';

import { captionStyleData } from '../src/shared/caption-style.ts';
import { assertReplayEdits, isEmptyEdits, normalizeEdits, type ReplayEdits } from '../src/shared/edits.ts';

const edits = (extra: Record<string, unknown>) => ({ version: 1, cuts: [], ...extra });

describe('caption style in the edit list', () => {
  it('accepts every documented value', () => {
    expect(() => assertReplayEdits(edits({ captionStyle: { size: 'l', position: 'top', background: 'translucent' } }), 1000)).not.toThrow();
  });

  it('rejects an unknown field or value with its path', () => {
    expect(() => assertReplayEdits(edits({ captionStyle: { colour: 'red' } }), 1000)).toThrow('edits.captionStyle.colour is not a supported field');
    expect(() => assertReplayEdits(edits({ captionStyle: { size: 'xl' } }), 1000)).toThrow('edits.captionStyle.size must be one of s, m, l');
  });

  it('saves only the values that differ from the defaults, and nothing when all are defaults', () => {
    const custom = normalizeEdits(edits({ captionStyle: { size: 'm', position: 'top', background: 'solid' } }) as ReplayEdits);
    expect(custom.captionStyle).toEqual({ position: 'top' });
    expect(normalizeEdits(edits({ captionStyle: { size: 'm' } }) as ReplayEdits)).not.toHaveProperty('captionStyle');
  });

  it('counts a non-default style as an edit', () => {
    expect(isEmptyEdits(edits({ captionStyle: { background: 'translucent' } }) as ReplayEdits)).toBe(false);
    expect(isEmptyEdits(edits({ captionStyle: { size: 'm' } }) as ReplayEdits)).toBe(true);
  });

  it('gives every renderer the same attributes, defaults filled in', () => {
    expect(captionStyleData({ size: 's' })).toEqual({ 'data-caption-size': 's', 'data-caption-position': 'bottom', 'data-caption-background': 'solid' });
  });
});

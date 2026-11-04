import { describe, expect, it } from 'vitest';

import { blockLabel, GLYPH_MIN_PX, wordsThatFit } from '../src/client/editor/block-label.ts';

describe('wordsThatFit', () => {
  it('shortens a label at a word boundary, never inside a word', () => {
    expect(wordsThatFit('Open checkout page now', 80)).toBe('Open');
  });

  it('wraps a label onto a second line before shortening it', () => {
    expect(wordsThatFit('Open checkout page now', 80, { lines: 2 })).toBe('Open checkout');
  });

  it('ends a shortened label before a small joining word', () => {
    expect(wordsThatFit('Look at the product grid', 80, { lines: 2 })).toBe('Look');
  });

  it('keeps a whole label that fits, small words included', () => {
    expect(wordsThatFit('Look at the shop', 200)).toBe('Look at the shop');
  });

  it('leaves less room for words in a block with more padding', () => {
    expect(wordsThatFit('Pick a product', 110)).toBe('Pick a product');
    expect(wordsThatFit('Pick a product', 110, { pad: 12 })).toBe('Pick');
  });

  it('keeps a value and its unit joined by a no-break space together, never ending on the bare number', () => {
    expect(wordsThatFit('Wait 1.5\u00a0s', 70)).toBe('Wait');
    expect(wordsThatFit('Wait 1.5\u00a0s', 90)).toBe('Wait 1.5\u00a0s');
  });

  it('shows nothing rather than fewer leading words than asked for', () => {
    expect(wordsThatFit('Type a coupon code', 60, { minWords: 2 })).toBe('');
    expect(wordsThatFit('Pay', 60, { minWords: 2 })).toBe('Pay');
  });

  it('fits words by the measure it is given instead of the estimate', () => {
    expect(wordsThatFit('Pick a product', 60, { measure: (text) => text.length * 3 })).toBe('Pick a product');
  });
});

describe('blockLabel', () => {
  it('shows the leading whole words when one fits', () => {
    expect(blockLabel('Review the cart', 70)).toEqual({ text: 'Review', glyph: false });
  });

  it('shows the lane glyph when not even the first word fits', () => {
    expect(blockLabel('Checkout', 40)).toEqual({ text: '', glyph: true });
  });

  it('shows nothing in a block too narrow for the glyph', () => {
    expect(blockLabel('Checkout', GLYPH_MIN_PX - 1)).toEqual({ text: '', glyph: false });
  });

  it('shows no glyph for a block with no label', () => {
    expect(blockLabel('  ', 200)).toEqual({ text: '', glyph: false });
  });
});

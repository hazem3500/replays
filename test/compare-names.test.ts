import { describe, expect, it } from 'vitest';

import { monograms, shortNames } from '../src/client/compare/tiles.ts';

describe('compared recordings’ names', () => {
  it('drops what every label shares, keeping what tells them apart', () => {
    expect(shortNames(['Checkout performance · Before', 'Checkout performance · After'])).toEqual(['Before', 'After']);
    expect(shortNames(['Desktop: run 1', 'Desktop: run 2'])).toEqual(['Run 1', 'Run 2']);
  });

  it('drops a note every label ends with', () => {
    expect(shortNames(['Checkout · before (fictional demo)', 'Checkout · after (fictional demo)'])).toEqual(['Before', 'After']);
  });

  it('keeps labels with nothing in common exactly as written', () => {
    expect(shortNames(['Demo shop: checkout with a bad coupon', 'Demo signup form'])).toEqual([
      'Demo shop: checkout with a bad coupon',
      'Demo signup form',
    ]);
  });

  it('numbers names that would repeat', () => {
    expect(shortNames(['Nightly', 'Nightly'])).toEqual(['Nightly', 'Nightly 2']);
  });

  it('keeps a lone label whole', () => {
    expect(shortNames(['Checkout · Before'])).toEqual(['Checkout · Before']);
  });

  it('marks runs by initial when the initials tell them apart', () => {
    expect(monograms(['Chrome', 'firefox', 'Safari', 'Edge'])).toEqual(['C', 'F', 'S', 'E']);
  });

  it('marks runs by position when two initials would repeat', () => {
    expect(monograms(['Run 1', 'Run 2', 'Safari'])).toEqual(['1', '2', '3']);
  });
});

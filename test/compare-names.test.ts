import { describe, expect, it } from 'vitest';

import { shortNames } from '../src/client/compare/tiles.ts';

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
});

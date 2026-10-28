import { describe, expect, it } from 'vitest';

import { rankCandidates } from '../src/client/compare/candidates.ts';

const replay = ([id, title, url, capturedAt, runId]: [string, string, string, string, string?]) => ({
  id,
  title,
  url,
  capturedAt,
  host: new URL(url).host,
  ...(runId ? { suiteRun: { suiteId: `suite-${id}`, runId } } : {}),
});

const base = { ...replay(['base', 'Checkout · before (fictional demo)', 'https://shop.test/checkout', '2026-10-26', 'checkout-desktop']) };

describe('compare with candidates', () => {
  it('puts the same scenario, a similar title or the same page ahead of unrelated recordings', () => {
    const { similar, others } = rankCandidates(base, [
      replay(['blog', 'Read the blog', 'https://blog.test/posts', '2026-10-27']),
      replay(['after', 'Checkout · after (fictional demo)', 'https://shop.test/checkout/', '2026-10-25']),
      replay(['rerun', 'Nightly run 4', 'https://shop.test/cart', '2026-10-24', 'checkout-desktop']),
      replay(['same-host', 'Account settings', 'https://shop.test/account', '2026-10-27']),
    ]);
    expect(similar.map((item) => item.id)).toEqual(['rerun', 'after', 'same-host']);
    expect(others.map((item) => item.id)).toEqual(['blog']);
  });

  it('never offers the recording itself', () => {
    const { similar, others } = rankCandidates(base, [base]);
    expect([...similar, ...others]).toEqual([]);
  });

  it('orders equally good matches newest first', () => {
    const { similar } = rankCandidates(base, [
      replay(['older', 'Checkout · after', 'https://shop.test/checkout', '2026-10-20']),
      replay(['newer', 'Checkout · after', 'https://shop.test/checkout', '2026-10-27']),
    ]);
    expect(similar.map((item) => item.id)).toEqual(['newer', 'older']);
  });
});

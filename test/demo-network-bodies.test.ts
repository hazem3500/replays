import { describe, expect, it } from 'vitest';

import { createComparisonSeed } from '../scripts/demo-comparison-seed.mjs';
import { createDemoSeed } from '../scripts/demo-seed.mjs';
import { sanitizeReplayBundle } from '../src/capture/sanitize.ts';
import type { ReplayBundle, ReplayNetworkEntry } from '../src/shared/replay.ts';

const { replays } = createDemoSeed() as { replays: ReplayBundle[] };
const byId = new Map(replays.map((replay) => [replay.meta.id, replay]));
const request = (replayId: string, entryId: string): ReplayNetworkEntry => {
  const entry = byId.get(replayId)?.network.find((item) => item.id === entryId);
  if (!entry) throw new Error(`missing ${replayId}/${entryId}`);
  return entry;
};
const parsed = (text: string | undefined) => JSON.parse(text ?? 'null') as Record<string, unknown>;

describe('demo network bodies', () => {
  it('never ships the fake secrets the synthetic bodies are written with', () => {
    expect(JSON.stringify(replays)).not.toMatch(/robin@|avery@|tok_demo_|4242 4242|"cvc":"123"|eyJhbGci/);
  });

  it('shows redaction where a capture would apply it', () => {
    const order = parsed(request('demo-seed-checkout-error', 'checkout-submit').requestBody?.text);
    expect(order).toMatchObject({ email: '[redacted]', payment: { cardNumber: '[redacted]', cvc: '[redacted]', expiry: '12/29' } });
  });

  it('backs the coupon console warning with the 422 coupon_expired body', () => {
    const coupon = request('demo-seed-checkout-error', 'checkout-coupon');
    const warning = byId.get('demo-seed-checkout-error')?.console.find((entry) => entry.level === 'warn');
    expect(coupon.status).toBe(422);
    expect(parsed(coupon.responseBody?.text)).toMatchObject({ error: 'coupon_expired', cart: { retained: true } });
    expect(warning?.message).toBe('Coupon validation returned 422 (coupon_expired); cart retained.');
  });

  it('backs the digest fallback warning with the stored value it could not read', () => {
    expect(parsed(request('demo-seed-console-diagnostics', 'preferences-read').responseBody?.text)).toMatchObject({
      digestSchedule: 'fortnightly',
    });
  });

  it('cuts the long search page at 64 KiB and keeps its full size', () => {
    const body = request('demo-seed-dashboard-search', 'dashboard-more').responseBody;
    expect(body?.truncated).toBe(true);
    expect(new TextEncoder().encode(body?.text).length).toBeLessThanOrEqual(64 * 1024);
    expect(body?.size).toBeGreaterThan(64 * 1024);
  });

  it('records the timed-out export response as unavailable', () => {
    expect(request('demo-seed-network-retry', 'export-first').responseBody).toEqual({ omitted: 'unavailable' });
  });

  it('keeps one headers-only replay so the "Not captured" state is demoable', () => {
    const headersOnly = replays.filter((replay) => replay.meta.captured?.network === 'headers');
    expect(headersOnly.map((replay) => replay.meta.id)).toEqual(['demo-seed-long-activity']);
    expect(JSON.stringify(headersOnly[0]?.network)).not.toMatch(/requestBody|responseBody/);
    expect(replays.filter((replay) => replay.meta.captured?.network === 'bodies')).toHaveLength(replays.length - 1);
  });

  it('survives the server privacy pass unchanged', () => {
    for (const replay of replays) expect(sanitizeReplayBundle(structuredClone(replay)).network).toEqual(replay.network);
  });

  it('gives each comparison run its own request ids', () => {
    const ids = createComparisonSeed().replays.map(
      (replay) => replay.network[0]?.requestHeaders.find((header) => header.name === 'x-request-id')?.value,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});

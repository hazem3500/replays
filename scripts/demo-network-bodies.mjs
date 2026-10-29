/* why: synthetic, fictional bodies for the demo seed. The secrets below are fake and exist so the demo shows where
   the real body redaction (src/shared/network-bodies.ts) replaces them. */

import { captureBody, REDACTED } from '../src/shared/network-bodies.ts';
import { compileRedaction } from '../src/shared/redaction.ts';

const JSON_TYPE = 'application/json; charset=utf-8';
const NO_RULES = compileRedaction({});
const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vLXVzZXIiLCJkZW1vIjp0cnVlfQ.ZGVtby1zaWduYXR1cmUtbm90LXJlYWw';
const encoder = new TextEncoder();

const json = (value) => ({ type: JSON_TYPE, text: JSON.stringify(value) });

/** A search page past the 64 KiB body cap, so the demo shows a truncated body. */
function largeActivityPage() {
  const services = ['web app', 'reports service', 'identity service', 'billing service'];
  const items = Array.from({ length: 420 }, (_, index) => ({
    id: `evt_demo_${String(1000 + index)}`,
    workspace: ['Delta', 'Cedar', 'Meadow', 'Harbor', 'Juniper'][index % 5],
    service: services[index % services.length],
    summary: `Fictional activity ${index + 1}: scheduled sync finished with ${index % 7} warnings`,
    at: new Date(Date.UTC(2026, 9, 18, 9, 20) - index * 60_000).toISOString(),
  }));
  return json({ cursor: 'demo-2', next: 'demo-3', total: 2_480, items });
}

/**
 * Bodies by network entry id. `request` is what the page sent, `response` what it got back, before redaction. An
 * entry without a response here (a failed request) records its response as unavailable.
 */
const BODIES = {
  'signup-post': {
    request: json({ name: 'Robin Example', email: 'robin@northstar.demo.test', plan: 'monthly-updates', consent: true }),
    response: json({
      id: 'sub_demo_7f3a',
      status: 'active',
      plan: 'monthly-updates',
      email: 'robin@northstar.demo.test',
      confirmationToken: 'tok_demo_9c1e0b7a44d2',
      createdAt: '2026-10-12T10:00:04.000Z',
    }),
  },
  'checkout-cart': {
    response: json({
      id: 'cart_demo_42',
      currency: 'USD',
      items: [
        { sku: 'TEA-PINE-01', name: 'Smoked pine tea', quantity: 1, unitPrice: 1400 },
        { sku: 'MUG-STONE-02', name: 'Stoneware mug', quantity: 1, unitPrice: 2400 },
      ],
      subtotal: 3800,
      coupon: null,
    }),
  },
  'checkout-coupon': {
    request: json({ code: 'SPRING10', cartId: 'cart_demo_42' }),
    response: json({
      error: 'coupon_expired',
      message: 'Coupon SPRING10 expired on 2026-09-30.',
      code: 'SPRING10',
      cart: { id: 'cart_demo_42', retained: true, subtotal: 3800 },
      requestId: 'req_demo_coupon',
    }),
  },
  'checkout-submit': {
    request: json({
      cartId: 'cart_demo_42',
      email: 'robin@pinecone.demo.test',
      payment: { method: 'card', cardNumber: '4242 4242 4242 4242', cvc: '123', expiry: '12/29' },
      total: 3800,
    }),
    response: json({ id: 'ord_demo_1093', status: 'received', total: 3800, currency: 'USD', coupon: null, cartRetained: false }),
  },
  'dashboard-page': {
    response: {
      type: 'text/html; charset=utf-8',
      text: '<!doctype html><html><head><title>Activity overview</title></head><body><main id="activity"></main><script src="/assets/activity.js"></script></body></html>',
    },
  },
  'dashboard-search': {
    response: json({
      query: 'invoice',
      total: 3,
      items: [
        {
          id: 'evt_demo_0937',
          workspace: 'Delta',
          service: 'web app',
          summary: 'Invoice review completed',
          at: '2026-10-18T09:37:00.000Z',
        },
        {
          id: 'evt_demo_0931',
          workspace: 'Cedar',
          service: 'reports service',
          summary: 'Invoice export scheduled',
          at: '2026-10-18T09:31:00.000Z',
        },
        {
          id: 'evt_demo_0922',
          workspace: 'Meadow',
          service: 'identity service',
          summary: 'Invoice access granted',
          at: '2026-10-18T09:22:00.000Z',
        },
      ],
    }),
  },
  'dashboard-identity': {
    response: json({ id: 'usr_demo_3', name: 'Avery Demo', email: 'avery@northstar.demo.test', role: 'operator', sessionToken: FAKE_JWT }),
  },
  'dashboard-more': { response: largeActivityPage() },
  'export-first': { request: json({ report: 'quarterly-activity', format: 'csv', attempt: 1 }) },
  'export-retry': {
    request: json({ report: 'quarterly-activity', format: 'csv', attempt: 2 }),
    response: json({ id: 'exp_demo_77', status: 'ready', rows: 4, download: '/demo/quarterly-activity-summary.csv' }),
  },
  'export-download': {
    response: {
      type: 'text/csv',
      text: 'workspace,events,warnings\nDelta,412,3\nCedar,388,0\nMeadow,257,1\nHarbor,190,0\n',
    },
  },
  'preferences-read': {
    response: json({ digestSchedule: 'fortnightly', channels: { email: true, push: false }, timezone: 'Europe/Lisbon' }),
  },
  'preferences-save': {
    request: json({ digestSchedule: 'weekly', channels: { email: true, push: false } }),
    response: json({ saved: true, digestSchedule: 'weekly', updatedAt: '2026-10-22T11:15:04.600Z' }),
  },
};

const header = (name, value) => ({ name, value });
const keep = (raw) => captureBody({ text: raw.text, mimeType: raw.type, size: encoder.encode(raw.text).length }, {}, { rules: NO_RULES });

/**
 * The entry as a capture with `network: 'bodies'` keeps it: redacted bodies plus the request id, accept, length and
 * cache headers a real API sends (all on the default header allowlist).
 */
function withBodies(entry) {
  const bodies = BODIES[entry.id];
  if (!bodies) return entry;
  const requestId = header('x-request-id', `req_demo_${entry.id}`);
  const responseHeaders = bodies.response
    ? [
        header('content-type', bodies.response.type),
        header('content-length', String(encoder.encode(bodies.response.text).length)),
        header('cache-control', 'no-store'),
        requestId,
      ]
    : [];
  return {
    ...entry,
    ...(bodies.response ? { mimeType: bodies.response.type.split(';')[0] } : {}),
    requestHeaders: [
      header('accept', bodies.response?.type.startsWith('text/') ? 'text/html,text/csv;q=0.9' : 'application/json'),
      ...(bodies.request ? [header('content-type', bodies.request.type)] : []),
      requestId,
    ],
    responseHeaders: entry.status === 0 ? [] : responseHeaders,
    ...(bodies.request ? { requestBody: keep(bodies.request) } : {}),
    responseBody: bodies.response && entry.status !== 0 ? keep(bodies.response) : { omitted: 'unavailable' },
  };
}

/**
 * The demo replay's network track and `meta.captured`. `bodies: false` keeps the replay as a headers-only capture, so the
 * viewer's "Not captured" state stays demoable.
 */
export function demoNetwork(network, { bodies = true, performance = false } = {}) {
  return {
    network: bodies ? network.map(withBodies) : network,
    captured: { console: true, network: bodies ? 'bodies' : 'headers', performance, video: false },
  };
}

export { REDACTED };

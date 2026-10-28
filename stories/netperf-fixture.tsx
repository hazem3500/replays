import type { ReactNode } from 'react';

import type { ReplayBundle, ReplayNetworkEntry, ReplayPerformanceEntry } from '../src/shared/replay.ts';
import { PlayerContext, ReplayController } from '../src/client/player.ts';
import { ViewerContext, type ViewerActions } from '../src/client/viewer/context.ts';

const API = 'https://api.pinecone.demo.test';
const CDN = 'https://cdn.pinecone.demo.test';

/** A deterministic sequence, so every render of a story draws the same requests. */
function sequence(seed: number) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

function entry(
  id: string,
  at: number,
  duration: number,
  url: string,
  status = 200,
  extra: Partial<ReplayNetworkEntry> = {},
): ReplayNetworkEntry {
  return {
    id,
    at,
    duration,
    method: 'GET',
    url,
    status,
    statusText: status >= 400 ? 'Error' : 'OK',
    ...(status ? { mimeType: 'application/json' } : {}),
    requestHeaders: [{ name: 'accept', value: 'application/json' }],
    responseHeaders: [{ name: 'content-length', value: '2048' }],
    ...extra,
  };
}

export const STEPS = [
  { at: 0, kind: 'open', label: 'Open the shop' },
  { at: 3000, kind: 'click', label: 'Add the tea to the cart' },
  { at: 4500, kind: 'click', label: 'Open the cart' },
  { at: 5700, kind: 'click', label: 'Apply the coupon' },
  { at: 9900, kind: 'click', label: 'Place the order' },
];

/** The three requests from Hazem's screenshot: a sparse recording. */
export const SPARSE: ReplayNetworkEntry[] = [
  entry('cart', 400, 96, `${API}/v1/cart`),
  entry('coupon', 5700, 140, `${API}/v1/coupons/SPRING10`, 422, { method: 'POST', statusText: 'Unprocessable Entity' }),
  entry('order', 9900, 305, 'https://orders.pinecone.demo.test/v1/orders', 201, { method: 'POST', statusText: 'Created' }),
];

/** Three hundred requests: assets at load, polling, bursts per step, a few failures and one 2.4 s outlier. */
export function busyNetwork(): ReplayNetworkEntry[] {
  const random = sequence(7);
  const list: ReplayNetworkEntry[] = [
    entry('doc', 0, 42, 'https://shop.pinecone.demo.test/', 200, { mimeType: 'text/html' }),
    entry('recommendations', 170, 2400, `${API}/v1/recommendations?for=home`),
    entry('tiles', 4520, 0, 'https://maps.demo.test/v3/tiles', 0, { statusText: 'net::ERR_BLOCKED_BY_CLIENT' }),
    ...SPARSE,
    entry('order-fail', 10_010, 305, 'https://orders.pinecone.demo.test/v1/orders', 500, { method: 'POST' }),
  ];
  for (let index = 0; list.length < 300; index++) {
    const at = Math.round(random() * 11_000);
    const image = index % 3 !== 0;
    const url = image ? `${CDN}/img/thumbs/${index}.webp` : `${API}/v1/notifications/poll`;
    list.push(
      entry(
        `r${index}`,
        at,
        Math.round(8 + random() * 140),
        url,
        at > 5200 && at < 5600 && !image ? 503 : 200,
        image ? { mimeType: 'image/webp' } : {},
      ),
    );
  }
  return list.toSorted((a, b) => a.at - b.at);
}

export const PERFORMANCE: ReplayPerformanceEntry[] = [
  { at: 196, kind: 'first-contentful-paint', value: 196 },
  { at: 196, kind: 'largest-contentful-paint', value: 196 },
  { at: 400, kind: 'long-task', value: 310 },
  { at: 3000, kind: 'long-task', value: 64 },
  { at: 3737, kind: 'slow-interaction', value: 72, eventType: 'pointerdown' },
  { at: 3739, kind: 'slow-interaction', value: 72, eventType: 'click' },
  { at: 4520, kind: 'long-task', value: 140 },
  { at: 5570, kind: 'slow-interaction', value: 56, eventType: 'input' },
  { at: 9900, kind: 'slow-interaction', value: 208, eventType: 'click' },
  { at: 9901, kind: 'long-task', value: 182 },
];

export function storyBundle(network: ReplayNetworkEntry[], performance?: ReplayPerformanceEntry[]): ReplayBundle {
  return {
    meta: {
      id: 'story',
      title: 'Checkout',
      url: 'https://shop.pinecone.demo.test/',
      capturedAt: '2026-10-28T10:00:00.000Z',
      duration: 11_100,
      viewport: { width: 1280, height: 800 },
      eventCount: 2,
      version: 1,
    },
    events: [
      { type: 4, timestamp: 1000 },
      { type: 2, timestamp: 12_100 },
    ],
    console: [],
    network,
    steps: STEPS,
    ...(performance
      ? { performance: { supported: ['paint', 'largest-contentful-paint', 'longtask', 'event'], entries: performance } }
      : {}),
  };
}

const noop = () => undefined;

const VIEWER: ViewerActions = {
  steps: STEPS,
  errors: [],
  setTab: noop,
  setExpandedRequest: noop,
  goToStep: noop,
  goToNextStep: noop,
  goToPreviousStep: noop,
  jumpToError: noop,
  goToNextError: noop,
  goToPreviousError: noop,
  copyLink: noop,
  switchFullscreen: noop,
  openShortcuts: noop,
  notify: noop,
  captions: false,
  switchCaptions: noop,
};

const players = new WeakMap<ReplayBundle, ReplayController>();

function playerFor(bundle: ReplayBundle) {
  const known = players.get(bundle);
  if (known) return known;
  const player = new ReplayController(bundle);
  players.set(bundle, player);
  return player;
}

/** A player for `bundle` (never mounted: the panels only read its clock) and stub viewer actions, in a dock-sized frame. */
export function PanelFrame({ bundle, width, children }: { bundle: ReplayBundle; width?: number; children: ReactNode }) {
  return (
    <PlayerContext.Provider value={playerFor(bundle)}>
      <ViewerContext.Provider value={VIEWER}>
        <div className="inspector" style={{ height: 320, width: width ?? '100%', display: 'flex', flexDirection: 'column' }}>
          <div className="inspector-panel">{children}</div>
        </div>
      </ViewerContext.Provider>
    </PlayerContext.Provider>
  );
}

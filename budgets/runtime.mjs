/** Runtime budgets live beside bundle.json. All limits are upper bounds. */
export const runtimeBudgets = {
  mode: 'report-only',
  samples: 3,
  settleMs: 1500,
  playbackMs: 2000,
  profiles: {
    desktop: { viewport: { width: 1280, height: 800 }, cpu: 1, latency: 0, download: -1, upload: -1 },
    // why: a synthetic mid-range phone, not a claim about a particular physical device.
    phone: { viewport: { width: 390, height: 780 }, cpu: 4, latency: 150, download: 200_000, upload: 93_750 },
  },
  pages: {
    'index-list': { path: '/', ready: '.feed-list:not(.feed-skeleton)', view: 'list' },
    // why: phones deliberately use list layout; a wide viewport + 4x CPU measures the grid on the phone profile.
    'index-grid': { path: '/', ready: '.feed-list[data-view="grid"]', view: 'grid', wide: true },
    viewer: { path: '/r/demo-seed-checkout-error', ready: '[data-testid="replay-player"] iframe', player: true },
    editor: { path: '/r/demo-seed-checkout-error/edit', ready: '[data-testid="timeline"][data-ready="true"]', player: true },
    comparison: {
      path: '/r/demo-seed-checkout-error?with=demo-seed-signup&layout=grid',
      ready: '[data-testid="compare-stage"] iframe',
      player: true,
      feature: 'comparison',
      tiles: 2,
    },
    settings: { path: '/', ready: '.feed-list:not(.feed-skeleton)', settings: true },
  },
  // why: provisional targets; calibrate against 10 main runs on the same runner before enabling enforcement.
  budgets: {
    desktop: {
      lcpMs: 2500,
      cls: 0.1,
      inpMs: 200,
      ttfbMs: 200,
      tbtMs: 200,
      longTasks: 20,
      firstFrameMs: 2500,
      scriptMs: 1000,
      jsUsedBytes: 1_500_000,
      requests: 45,
      transferBytes: 1_500_000,
      heapBytes: 100_000_000,
      frameTimeP95Ms: 50,
      mainThreadBusyPct: 40,
    },
    phone: {
      lcpMs: 4000,
      cls: 0.1,
      inpMs: 200,
      ttfbMs: 600,
      tbtMs: 600,
      longTasks: 40,
      firstFrameMs: 5000,
      scriptMs: 4000,
      jsUsedBytes: 1_500_000,
      requests: 45,
      transferBytes: 1_500_000,
      heapBytes: 100_000_000,
      frameTimeP95Ms: 100,
      mainThreadBusyPct: 70,
    },
  },
  server: {
    list: { path: '/api/replays', ttfbMs: 100, responseMs: 150, wireBytes: 40_000 },
    bundle: { path: '/api/replays/demo-seed-checkout-error', ttfbMs: 100, responseMs: 150, wireBytes: 100_000 },
    poster: { path: '/api/replays/demo-seed-checkout-error/poster', ttfbMs: 100, responseMs: 150, wireBytes: 60_000 },
  },
  ssrGate: {
    mode: 'report-only',
    indexRows: 100,
    serverSamples: 20,
    phone: { indexLcpMs: 1200, firstReplayTitleMs: 1000, viewerSkeletonFcpMs: 1000 },
    server: { ttfbP50Ms: 30, ttfbP90Ms: 60, htmlBrBytes: 15_000 },
    hydrationErrors: 0,
    hydrationRefetches: 0,
    // why: compare viewer content-ready medians against an SPA run on the same source and seed.
    maxViewerContentRegressionMs: 0,
  },
};

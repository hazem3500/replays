import { noneAuth } from '../src/server/auth/index.ts';
import { validateBranding } from '../src/server/branding.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import { SourceProviders } from '../src/shared/source-providers.ts';

export const replay = (id = 'test-replay'): ReplayBundle => ({
  meta: {
    id,
    title: 'Test replay',
    url: 'https://example.com/',
    capturedAt: '2026-10-06T00:00:00.000Z',
    duration: 1000,
    viewport: { width: 1440, height: 900 },
    eventCount: 2,
    version: 1,
  },
  events: [
    { type: 4, timestamp: 1000 },
    { type: 2, timestamp: 2000 },
  ],
  console: [],
  network: [],
  steps: [{ at: 0, kind: 'open', label: 'Open example.com', url: 'https://example.com/' }],
});

/** The `createApp` options every test needs: no sign-in, the default name, the built-in source providers. */
export const appDefaults = () => ({
  auth: noneAuth({}),
  branding: validateBranding(undefined),
  sources: new SourceProviders(),
});

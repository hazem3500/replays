import { defineConfig, type ReplaysConfig } from '@hazem3500/replays/config';
import gcs from '@hazem3500/replays/plugins/gcs';
import iap from '@hazem3500/replays/plugins/iap';

import company from './src/plugin.ts';
import { logoUrl, theme } from './src/theme.ts';

const list = (value: string | undefined) => value?.split(/[\s,]+/).filter(Boolean) ?? [];

/** Defaults to deployed: missing cloud configuration is an error, never a silent auth fallback. */
export function hostConfig(env: NodeJS.ProcessEnv = process.env): ReplaysConfig {
  const profile = env.HOST_APP_PROFILE?.trim() || 'deployed';
  if (profile !== 'local' && profile !== 'deployed') throw new Error('HOST_APP_PROFILE must be local or deployed');
  const local = profile === 'local';
  return defineConfig({
    name: 'Example Replays',
    distribution: { name: 'example-host', version: '0.0.0' },
    logoUrl,
    theme,
    basePath: '/replays',
    hosts: { 'replays.example.com': { basePath: '' } },
    // Enable only when the gateway strips untrusted forwarded headers and supplies its own.
    trustForwardedHost: false,
    auth: local ? 'none' : 'iap',
    storage: local ? 'fs' : 'gcs',
    signIn: local ? false : { path: '/api/sign-in' },
    capture: { stepPauseMs: 1200 },
    retentionDays: 90,
    purposes: [
      {
        id: 'triage',
        label: 'Triage',
        order: 0,
        retentionDays: 90,
        viewer: { openAt: 'first-error', leadMs: 1000, inspector: 'open' },
        poster: 'first-error',
      },
      {
        id: 'design-review',
        label: 'Design review',
        order: 1,
        retentionDays: 90,
        viewer: { openAt: 'start', inspector: 'collapsed' },
        poster: 'middle-step',
      },
      {
        id: 'walkthrough',
        label: 'Walkthrough',
        order: 2,
        retentionDays: 0,
        viewer: { openAt: 'start', captions: true, inspector: 'collapsed' },
        poster: 'last-step',
      },
    ],
    // Keep saved-edit playback/MP4 export, but forbid writing edits.
    beta: { editor: true },
    editing: { enabled: false },
    // Sandboxed plugins stay personal and read-only; this is separate from built-in comment and export permissions.
    malleable: {
      enabled: true,
      scopes: ['user'],
      capabilities: { 'comments:write': 'deny', 'export:download': 'deny' },
      lockedSurfaces: ['inspector:context', 'inspector:company-host:handoff'],
    },
    plugins: [
      ...(local ? [] : [iap(), gcs()]),
      company({
        staffDomain: env.HOST_APP_STAFF_DOMAIN?.trim().toLowerCase() || 'example.com',
        staffUploadOrigins: list(env.HOST_APP_STAFF_UPLOAD_ORIGINS),
      }),
    ],
  });
}

export default hostConfig();

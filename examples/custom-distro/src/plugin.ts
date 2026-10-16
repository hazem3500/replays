import { fileURLToPath } from 'node:url';

import { definePlugin, rejectUpload } from '@hazem3500/replays/plugin';

import { IDENTITY_HEADER, verifyIdentity } from './iap.ts';

export interface AcmeOptions {
  /** The audience the proxy signs identities for. */
  audience: string;
  /** Email domain that may sign in. */
  domain: string;
}

// A tiny inline mark; a real distribution ships its own asset (a data: image or an https URL).
const LOGO = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#ff6600"/><path fill="#fff" d="M8 6l10 6-10 6z"/></svg>',
).toString('base64')}`;

/** What the example's hooks observed; served at /_distro/stats to prove they ran. */
const stats = { responses: 0, uploads: 0 };

export default definePlugin((options: AcmeOptions) => ({
  name: 'acme-distro',
  setup(api) {
    // 1. Auth: only requests carrying a valid signed identity get in.
    api.auth({
      name: 'acme-iap',
      create(env) {
        const secret = env.DISTRO_SIGNING_SECRET?.trim();
        if (!secret) throw new Error('DISTRO_SIGNING_SECRET is required');
        return {
          name: 'acme-iap',
          authenticate(request) {
            const token = request.headers[IDENTITY_HEADER];
            const claims = typeof token === 'string' ? verifyIdentity(token, { secret, audience: options.audience }) : undefined;
            if (!claims?.email.endsWith(`@${options.domain}`)) return undefined;
            return {
              id: claims.email,
              email: claims.email,
              ...(claims.name ? { name: claims.name } : {}),
              ...(claims.avatarUrl ? { avatarUrl: claims.avatarUrl } : {}),
            };
          },
        };
      },
    });

    // 2. Context adapter: every upload is stamped with who sent it and where the build runs.
    api.contextAdapter({
      name: 'acme-context',
      schema: {
        type: 'object',
        properties: {
          environment: { type: 'string', title: 'Environment' },
          uploadedBy: { type: 'string', title: 'Uploaded by' },
        },
      },
      normalize(context, { identity, request }) {
        const environment = request.headers['x-acme-environment'];
        return {
          version: 1,
          capturedAt: context?.capturedAt ?? new Date().toISOString(),
          ...context,
          fields: {
            environment: typeof environment === 'string' ? environment : 'staging',
            ...context?.fields,
            uploadedBy: identity.email ?? identity.id,
          },
        };
      },
    });

    // 3. A source-link provider: `acme-chat:C123/p456` becomes a link to the thread.
    api.sourceProvider({
      id: 'acme-chat',
      label: 'Acme Chat',
      resolve: (ref) =>
        /^C\w+\/p\d+$/.test(ref) ? { url: `https://chat.example.com/archives/${ref}`, label: `thread ${ref}` } : undefined,
    });

    // 4. Branding and base path.
    api.branding({
      name: 'Acme Replays',
      logoUrl: LOGO,
      theme: { dark: { accent: '#ff6600', 'accent-contrast': '#1a0b00' }, light: { accent: '#b84700', 'accent-contrast': '#ffffff' } },
    });
    api.basePath('/acme/replays');

    // 5. Server hooks: a small endpoint behind the same auth, response counting, upload lifecycle.
    api.onRequest(({ path, response, identity }) => {
      if (path !== '/_distro/stats') return;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ...stats, user: identity?.id }));
      return true;
    });
    api.onResponse(() => {
      stats.responses += 1;
    });
    api.beforeUpload(({ bundle }) => {
      if (bundle.meta.title.includes('[no-upload]')) throw rejectUpload(422, 'this distribution refuses [no-upload] recordings');
    });
    api.afterUpload(() => {
      stats.uploads += 1;
    });

    // 6. The browser entry: a tab, an action and a panel (built by scripts/build.mjs).
    api.client({ id: 'main', script: fileURLToPath(new URL('../dist/client.js', import.meta.url)) });
  },
}));

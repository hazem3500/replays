import { publicConfig } from '../branding.ts';
import { defineRoute } from '../http/route.ts';
import { json } from '../http/respond.ts';
import { peopleConfig } from '../people.ts';
import { publicIndexFilters } from '../summary-fields.ts';
import type { ApiServices } from './services.ts';

/** `/api/cli/auth/status`, `/api/config` and `/api/me`: who is signed in, and what this deployment offers. */
export function sessionRoutes(services: ApiServices) {
  const { deployment, registry } = services;
  const routeContext = (base: string) => ({ base, ...(deployment.publicOrigin ? { publicOrigin: deployment.publicOrigin } : {}) });
  return [
    defineRoute({
      method: 'GET',
      path: '/api/cli/auth/status',
      handler: ({ identity: user }) =>
        json(
          200,
          {
            identity: { id: user.id, ...(user.email ? { email: user.email } : {}), ...(user.name ? { name: user.name } : {}) },
            ...(user.authExpiresAt ? { expiresAt: user.authExpiresAt } : {}),
            scopes: user.authScopes ?? [],
          },
          { cacheControl: 'no-store' },
        ),
    }),
    defineRoute({
      method: 'GET',
      path: '/api/config',
      async handler({ base }) {
        let cliDeviceAuth;
        try {
          cliDeviceAuth = await deployment.auth.cliDeviceAuth?.(routeContext(base));
        } catch {
          cliDeviceAuth = undefined;
        }
        return json(
          200,
          publicConfig(deployment.branding, {
            ...(deployment.contextSchema ? { contextSchema: deployment.contextSchema.schema } : {}),
            sourceProviders: deployment.sources.ids,
            auth: deployment.auth.name,
            ...(cliDeviceAuth ? { cliDeviceAuth } : {}),
            ...(services.signIn ? { signIn: services.signIn } : {}),
            plugins: [...registry.order],
            profiles: deployment.store.profiles.list,
            views: deployment.views.list,
            ...(registry.indexFilters.length ? { indexFilters: publicIndexFilters(registry.indexFilters) } : {}),
            beta: {
              editor: Boolean(deployment.beta?.editor),
              cursorCustomization: Boolean(deployment.beta?.cursorCustomization),
              malleable: Boolean(deployment.beta?.malleable),
            },
            comments: services.commentsOn,
            versions: services.versions,
            ...(deployment.beta?.malleable ? { malleable: services.policy } : {}),
            editing: services.editing,
          }),
        );
      },
    }),
    defineRoute({
      method: 'GET',
      path: '/api/me',
      // why: revalidated, not `no-store`: `no-store` would keep the index out of the back/forward cache.
      handler({ identity: user, base }) {
        const people = peopleConfig(registry);
        const signOutUrl = deployment.auth.signOutUrl?.(routeContext(base));
        // invariant: AUTH_MODE=none gives every request the same stand-in identity; nobody is signed in.
        const session = { signedIn: deployment.auth.name !== 'none', ...(signOutUrl ? { signOutUrl } : {}) };
        return json(200, { ...user, ...(people ? { people } : {}), session });
      },
    }),
  ];
}

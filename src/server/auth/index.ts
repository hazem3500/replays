import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { headerAuth } from './header.ts';
import { noneAuth } from './none.ts';
import { oidcAuth } from './oidc.ts';
import type { AuthAdapter, AuthPluginFactory } from './types.ts';

export * from './types.ts';
export { headerAuth } from './header.ts';
export { noneAuth } from './none.ts';
export { oidcAuth } from './oidc.ts';

const list = (value: string | undefined) =>
  (value ?? '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * Builds the auth adapter from the environment.
 *
 *   AUTH_MODE=none    (default) everyone is the same anonymous user
 *   AUTH_MODE=header  trust AUTH_HEADER set by a reverse proxy at AUTH_TRUSTED_PROXIES
 *   AUTH_MODE=oidc    OpenID Connect sign-in (OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_SESSION_SECRET, PUBLIC_ORIGIN; optional public-client CLI device flow)
 *   AUTH_MODE=plugin  AUTH_PLUGIN=<module> whose default export is an AuthPluginFactory (see examples/)
 */
export async function authFromEnv(env: NodeJS.ProcessEnv): Promise<AuthAdapter> {
  const mode = (env.AUTH_MODE ?? 'none').trim().toLowerCase();
  const need = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`AUTH_MODE=${mode} needs ${name}`);
    return value;
  };
  switch (mode) {
    case 'none':
      return noneAuth(env);
    case 'header':
      return headerAuth({
        header: need('AUTH_HEADER'),
        trustedProxies: list(env.AUTH_TRUSTED_PROXIES),
        ...(env.AUTH_NAME_HEADER ? { nameHeader: env.AUTH_NAME_HEADER } : {}),
        allow: list(env.AUTH_ALLOW),
      });
    case 'oidc':
      return oidcAuth({
        issuer: need('OIDC_ISSUER'),
        clientId: need('OIDC_CLIENT_ID'),
        ...(env.OIDC_CLIENT_SECRET ? { clientSecret: env.OIDC_CLIENT_SECRET } : {}),
        sessionSecret: need('OIDC_SESSION_SECRET'),
        publicOrigin: need('PUBLIC_ORIGIN'),
        ...(env.OIDC_SCOPES ? { scopes: env.OIDC_SCOPES } : {}),
        ...(env.OIDC_AUDIENCE ? { audience: env.OIDC_AUDIENCE } : {}),
        ...(env.OIDC_DEVICE_FLOW === 'true' ? { deviceFlow: true } : {}),
        ...(env.OIDC_DEVICE_RESOURCE ? { deviceResource: env.OIDC_DEVICE_RESOURCE } : {}),
        allow: list(env.AUTH_ALLOW),
      });
    case 'plugin': {
      const specifier = need('AUTH_PLUGIN');
      const target = /^(\.|\/)/.test(specifier) ? pathToFileURL(resolve(specifier)).href : specifier;
      const loaded = (await import(target)) as { default?: AuthPluginFactory };
      if (typeof loaded.default !== 'function')
        throw new Error(`AUTH_PLUGIN ${specifier} must default-export a function (env) => AuthAdapter`);
      const adapter = await loaded.default(env);
      if (!adapter || typeof adapter.authenticate !== 'function') throw new Error(`AUTH_PLUGIN ${specifier} did not return an AuthAdapter`);
      return adapter;
    }
    default:
      throw new Error(`AUTH_MODE must be none, header, oidc or plugin (got ${JSON.stringify(env.AUTH_MODE)})`);
  }
}

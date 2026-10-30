/**
 * `@hazem3500/replays/plugins/iap`: sign-in through Google Cloud's Identity-Aware Proxy. A first-party plugin: it uses only the
 * public `/plugin` and `/server` surface, so it is also a worked example of a proxy auth adapter.
 *
 *   import iap from '@hazem3500/replays/plugins/iap';
 *   export default defineConfig({ auth: 'iap', plugins: [iap({ audience: '/projects/123/global/backendServices/456', domains: ['example.com'] })] });
 */
import type { IncomingMessage } from 'node:http';

import { definePlugin } from '../plugin/index.ts';
import { type AuthAdapter, type Identity, verifyJwt } from '../server/index.ts';

export const IAP_ISSUER = 'https://cloud.google.com/iap';
/** Google's IAP signing keys as a JWKS (ES256). */
export const IAP_JWKS_URL = 'https://www.gstatic.com/iap/verify/public_key-jwk';
const HEADER = 'x-goog-iap-jwt-assertion';

/** A Google service account's email (`name@project.iam.gserviceaccount.com`, or a Google-managed one). */
const SERVICE_ACCOUNT = /^[a-z0-9][a-z0-9.-]*@[a-z0-9.-]+\.gserviceaccount\.com$/;
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export interface IapOptions {
  /**
   * The expected `aud`: `/projects/<number>/global/backendServices/<id>` (a load balancer backend) or
   * `/projects/<number>/apps/<project-id>` (App Engine). Env: `IAP_JWT_AUDIENCE`.
   */
  audience?: string;
  /** Authenticated return endpoint for a CDN viewer; false disables recovery. */
  signIn?: import('../server/index.ts').SignInConfig | false;
  /** Email domains whose people are let in (`example.com`; exact, no subdomains). Env: `IAP_ALLOWED_DOMAINS`, comma- or space-separated. */
  domains?: readonly string[];
  /**
   * Service accounts let in besides the domains, by exact email. Only `*.gserviceaccount.com` addresses may be listed; anything else
   * stops the server. IAP must let them through as well (IAP-secured Web App User). Env: `IAP_SERVICE_ACCOUNTS`.
   */
  serviceAccounts?: readonly string[];
  /**
   * Local development only: the email to use for a request without the IAP header (there is no proxy on a laptop). Requests that
   * carry the header are still verified. Never set it where the app is reachable without IAP in front.
   */
  devFallback?: string;
  /** The `fetch` used for Google's keys (tests, an egress proxy). */
  fetch?: typeof fetch;
  /** Seconds since the epoch; default now. For tests. */
  now?: () => number;
}

const list = (value: string | readonly string[] | undefined) =>
  (typeof value === 'string' ? value.split(/[\s,]+/) : (value ?? [])).map((entry) => entry.trim().toLowerCase()).filter(Boolean);

/** The options with the environment filled in, checked. Throws the start-up error for a bad list. */
export function resolveIapOptions(options: IapOptions, env: NodeJS.ProcessEnv) {
  const audience = (options.audience ?? env.IAP_JWT_AUDIENCE)?.trim();
  const domains = list(options.domains ?? env.IAP_ALLOWED_DOMAINS).map((domain) => domain.replace(/^@/, ''));
  const serviceAccounts = list(options.serviceAccounts ?? env.IAP_SERVICE_ACCOUNTS);
  const devFallback = options.devFallback?.trim().toLowerCase() || undefined;
  const badDomains = domains.filter((domain) => !DOMAIN.test(domain));
  if (badDomains.length) throw new Error(`iap: ${badDomains.map((d) => JSON.stringify(d)).join(', ')} is not an email domain`);
  const badAccounts = serviceAccounts.filter((account) => !SERVICE_ACCOUNT.test(account));
  if (badAccounts.length)
    throw new Error(
      `iap: serviceAccounts may only list *.gserviceaccount.com addresses; refusing ${badAccounts.map((a) => JSON.stringify(a)).join(', ')}`,
    );
  if (!domains.length && !serviceAccounts.length)
    throw new Error('iap needs domains or serviceAccounts (IAP_ALLOWED_DOMAINS, IAP_SERVICE_ACCOUNTS)');
  return { audience, domains, serviceAccounts, devFallback };
}

/** The adapter itself, for use without the plugin (`AUTH_MODE=plugin`, tests). */
export function iapAuth(options: IapOptions, env: NodeJS.ProcessEnv = process.env): AuthAdapter {
  const { audience, domains, serviceAccounts, devFallback } = resolveIapOptions(options, env);
  if (!audience) throw new Error('iap needs an audience (IAP_JWT_AUDIENCE): /projects/<number>/global/backendServices/<id>');
  const allowed = (email: string) => domains.some((domain) => email.endsWith(`@${domain}`)) || serviceAccounts.includes(email);
  if (devFallback) console.warn(`iap: requests without ${HEADER} are signed in as ${devFallback} (devFallback; never in production)`);
  return {
    name: 'iap',
    ...(options.signIn === false ? {} : { signIn: options.signIn ?? { path: '/api/sign-in' } }),
    async authenticate(request: IncomingMessage): Promise<Identity | undefined> {
      const assertion = request.headers[HEADER];
      if (assertion === undefined && devFallback) return { id: devFallback, email: devFallback };
      if (typeof assertion !== 'string' || !assertion) return undefined;
      const claims = await verifyJwt({
        token: assertion,
        jwksUrl: IAP_JWKS_URL,
        issuer: IAP_ISSUER,
        audience,
        algorithms: ['ES256'],
        requireIat: true,
        leewaySec: 30,
        ...(options.fetch ? { fetch: options.fetch } : {}),
        ...(options.now ? { now: options.now() } : {}),
      });
      // Exact audience: IAP sets one string, never a list.
      if (!claims || claims.aud !== audience) return undefined;
      const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
      if (!email || email.length > 254 || !allowed(email)) return undefined;
      return { id: email, email };
    },
  };
}

/**
 * The `iap` plugin: registers the `iap` auth adapter (select it with `auth: 'iap'` or `AUTH_MODE=iap`; with no other plugin adapter
 * it is used by default). Lists are checked when the server starts, whichever adapter is selected.
 */
const plugin = definePlugin((options: IapOptions) => ({
  name: 'iap',
  setup(api) {
    resolveIapOptions(options, api.env);
    api.auth({ name: 'iap', create: (env) => iapAuth(options, env) });
  },
}));

export default function iap(options: IapOptions = {}) {
  return plugin(options);
}

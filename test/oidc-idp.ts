import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';

import { createApp } from '../src/server/app.ts';
import { oidcAuth } from '../src/server/auth/oidc.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults, replay } from './fixtures.ts';

export const CLIENT_ID = 'replays-client';
export const CLIENT_SECRET = 'client-secret-for-tests';
export const SESSION_SECRET = 'a-session-secret-of-at-least-16-chars';
export const PUBLIC_ORIGIN = 'https://replays.example.test';
const START_MS = Date.parse('2026-10-14T10:00:00.000Z');

export const b64 = (value: Buffer | string): string => Buffer.from(value).toString('base64url');

const signing = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...signing.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
/** A key the provider never published, for forged tokens. */
export const otherKey: KeyObject = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;

/** How a test token is signed: the provider's key and kid by default. */
export interface MintOptions {
  key?: KeyObject;
  kid?: string;
  alg?: string;
}

/** A signed JWT carrying `claims`; `alg: 'none'` leaves the signature empty. */
export function mint(claims: Record<string, unknown>, options: MintOptions = {}): string {
  const header = b64(JSON.stringify({ alg: options.alg ?? 'RS256', kid: options.kid ?? 'test-key', typ: 'JWT' }));
  const payload = b64(JSON.stringify(claims));
  const signature =
    options.alg === 'none' ? '' : b64(sign('sha256', Buffer.from(`${header}.${payload}`), options.key ?? signing.privateKey));
  return `${header}.${payload}.${signature}`;
}

/** A machine token's claims, valid for five minutes from the provider's start time. */
export const bearerClaims = (issuer: string, extra: Record<string, unknown> = {}, now = START_MS / 1000): Record<string, unknown> => ({
  iss: issuer,
  aud: CLIENT_ID,
  sub: 'ci-bot',
  iat: now,
  exp: now + 300,
  ...extra,
});

/** Uploads a replay with a bearer token, as a CI job would. */
export const upload = (origin: string, token: string, id = 'machine-upload'): Promise<Response> =>
  fetch(`${origin}/api/replays`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(replay(id)),
  });

/** The cookies a response sets, as a `cookie` request header (what a browser would send back). */
const jar = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((line) => line.split(';')[0] ?? '')
    .filter((pair) => !pair.endsWith('='))
    .join('; ');

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function originOf(server: Server): string {
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('server is not listening on a port');
  return `http://127.0.0.1:${address.port}`;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return originOf(server);
}

const closeServer = (server: Server) => (): Promise<void> => new Promise<void>((resolve) => server.close(() => resolve()));

interface Pending {
  nonce: string;
  challenge: string;
  redirectUri: string;
  claims: Record<string, unknown>;
}

/** What a test may change about the provider while it runs. */
export interface IdpState {
  issuerInDiscovery: string | undefined;
  tokenStatus: number;
  nonceOverride: string | undefined;
  audience: string;
}

/** An in-process identity provider: discovery, JWKS, and a token endpoint that checks the code, PKCE and client. */
export interface Idp {
  issuer: string;
  state: IdpState;
  tokenRequests: URLSearchParams[];
  /** What the provider does after the user signs in: remembers the request and returns a code. */
  authorize: (authorizeUrl: string, claims: Record<string, unknown>) => string;
  close: () => Promise<void>;
}

function validGrant(form: URLSearchParams, pending: Pending | undefined, state: IdpState): pending is Pending {
  const verifier = form.get('code_verifier') ?? '';
  return (
    state.tokenStatus === 200 &&
    pending !== undefined &&
    form.get('grant_type') === 'authorization_code' &&
    form.get('client_id') === CLIENT_ID &&
    form.get('client_secret') === CLIENT_SECRET &&
    form.get('redirect_uri') === pending.redirectUri &&
    b64(createHash('sha256').update(verifier).digest()) === pending.challenge
  );
}

async function startIdp(clock: () => number): Promise<Idp> {
  const codes = new Map<string, Pending>();
  const tokenRequests: URLSearchParams[] = [];
  const state: IdpState = { issuerInDiscovery: undefined, tokenStatus: 200, nonceOverride: undefined, audience: CLIENT_ID };
  const token = async (request: IncomingMessage, response: ServerResponse, issuer: string) => {
    const form = new URLSearchParams(await text(request));
    tokenRequests.push(form);
    const pending = codes.get(form.get('code') ?? '');
    codes.delete(form.get('code') ?? '');
    if (!validGrant(form, pending, state)) {
      sendJson(response, state.tokenStatus === 200 ? 400 : state.tokenStatus, { error: 'invalid_grant' });
      return;
    }
    const now = Math.floor(clock() / 1000);
    const claims = { iss: issuer, aud: state.audience, iat: now, exp: now + 300, nonce: state.nonceOverride ?? pending.nonce };
    sendJson(response, 200, { id_token: mint({ ...claims, ...pending.claims }) });
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://idp');
    const issuer = originOf(server);
    if (url.pathname === '/.well-known/openid-configuration') {
      const endpoints = { authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` };
      sendJson(response, 200, { issuer: state.issuerInDiscovery ?? issuer, ...endpoints });
    } else if (url.pathname === '/jwks') sendJson(response, 200, { keys: [jwk] });
    else if (url.pathname === '/token' && request.method === 'POST') void token(request, response, issuer);
    else sendJson(response, 404, { error: 'not found' });
  });
  const issuer = await listen(server);
  const authorize = (authorizeUrl: string, claims: Record<string, unknown>): string => {
    const params = new URL(authorizeUrl).searchParams;
    const code = b64(randomBytes(12));
    const pending = {
      nonce: params.get('nonce') ?? '',
      challenge: params.get('code_challenge') ?? '',
      redirectUri: params.get('redirect_uri') ?? '',
      claims,
    };
    codes.set(code, pending);
    return code;
  };
  return { issuer, state, tokenRequests, authorize, close: closeServer(server) };
}

/** How a test deployment's OIDC adapter and app are configured. */
export interface OidcSetup {
  allow?: string[];
  audience?: string;
  basePath?: string;
  sessionHours?: number;
  signIn?: { path: string };
}

/** One browser sign-in: the login redirect, the provider's code and the callback with its session cookie. */
export interface SignedIn {
  login: Response;
  authorizeUrl: string;
  params: URLSearchParams;
  loginCookie: string;
  code: string;
  callback: Response;
  session: string;
}

/** A running app behind the OIDC adapter, its provider and a clock the test moves. */
export interface OidcApp {
  idp: Idp;
  clock: { now: number };
  origin: string;
  base: string;
  get: (path: string, headers?: Record<string, string>) => Promise<Response>;
  signIn: (claims?: Record<string, unknown>, next?: string) => Promise<SignedIn>;
}

function oidcAdapter(idp: Idp, clock: { now: number }, setup: OidcSetup): ReturnType<typeof oidcAuth> {
  return oidcAuth({
    issuer: idp.issuer,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    sessionSecret: SESSION_SECRET,
    publicOrigin: PUBLIC_ORIGIN,
    now: () => clock.now,
    ...(setup.allow ? { allow: setup.allow } : {}),
    ...(setup.audience ? { audience: setup.audience } : {}),
    ...(setup.sessionHours ? { sessionHours: setup.sessionHours } : {}),
  });
}

/** Starts a provider and an app signed in through it; `closers` collects what the test's `afterEach` shuts down. */
export async function startOidcApp(setup: OidcSetup, closers: Array<() => Promise<void>>): Promise<OidcApp> {
  const clock = { now: START_MS };
  const idp = await startIdp(() => clock.now);
  closers.push(idp.close);
  const base = setup.basePath ?? '';
  const root = await mkdtemp(join(tmpdir(), 'replays-oidc-'));
  const handle = createApp({
    ...appDefaults(),
    auth: oidcAdapter(idp, clock, setup),
    store: new ReplayStore(join(root, 'data'), join(root, 'sample')),
    clientDir: join(root, 'client'),
    basePath: base,
    ...(setup.signIn ? { signIn: setup.signIn } : {}),
    publicOrigin: PUBLIC_ORIGIN,
  });
  const server = createServer((request, response) => void handle(request, response));
  const origin = await listen(server);
  closers.push(closeServer(server));
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${origin}${path}`, { redirect: 'manual', headers });
  const signIn = async (
    claims: Record<string, unknown> = { sub: 'user-1', email: 'ada@example.com', name: 'Ada Example' },
    next?: string,
  ) => {
    const login = await get(`${base}/auth/login${next === undefined ? '' : `?next=${encodeURIComponent(next)}`}`);
    const authorizeUrl = login.headers.get('location') ?? '';
    const loginCookie = jar(login);
    const params = new URL(authorizeUrl).searchParams;
    const code = idp.authorize(authorizeUrl, claims);
    const callback = await get(`${base}/auth/callback?code=${code}&state=${params.get('state') ?? ''}`, { cookie: loginCookie });
    return { login, authorizeUrl, params, loginCookie, code, callback, session: jar(callback) };
  };
  return { idp, clock, origin, base, get, signIn };
}

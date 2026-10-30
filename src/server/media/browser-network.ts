import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';

import type { BrowserContext, Route } from 'playwright-core';

export interface RenderAssetPolicy {
  assets?: 'public' | 'origin-only';
  /** Exact hostnames or IP literals, explicitly trusted to reach internal assets. */
  allowHosts?: string[];
}

type Address = { address: string; family: number };
type Resolver = (hostname: string) => Promise<Address[]>;

/** Only globally routable addresses; reject transition mechanisms that can hide private IPv4. */
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return !(
      address === '168.63.129.16' ||
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (isIP(address) !== 6) return false;
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  if (normalized.startsWith('::ffff:')) {
    const words = normalized.slice(7).split(':');
    const value = parseInt(words[0]!, 16) * 65536 + parseInt(words[1]!, 16);
    return publicAddress([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.'));
  }
  return /^[23][0-9a-f]{3}:/.test(normalized) && !/^2001:(?:0:|:)|^2002:|^2001:db8:/i.test(normalized);
}

/** Resolve on every request, checking every answer; callers must connect to the returned address. */
export async function assetAddress(
  url: URL,
  origin: string,
  policy: RenderAssetPolicy = {},
  resolve: Resolver = (host) => lookup(host, { all: true, verbatim: true }),
): Promise<Address> {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('blocked render URL');
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '');
  const own = url.origin === origin;
  const allowed = policy.allowHosts?.some(
    (entry) =>
      entry
        .toLowerCase()
        .replace(/^\[|\]$/g, '')
        .replace(/\.$/, '') === host,
  );
  if (
    !own &&
    !allowed &&
    (policy.assets === 'origin-only' ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === 'metadata.google.internal' ||
      host.endsWith('.metadata.google.internal'))
  )
    throw new Error('blocked render host');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
  if (!addresses.length || (!own && !allowed && addresses.some(({ address }) => !publicAddress(address))))
    throw new Error('blocked render address');
  return addresses[0]!;
}

/** Pin the upstream socket to the checked address; Chromium never performs a second DNS lookup. */
async function forward(route: Route, url: URL, address: Address, headers: Record<string, string>, own: boolean) {
  const body = await new Promise<{ status: number; headers: Record<string, string>; body: Buffer }>((resolve, reject) => {
    const transportOptions: RequestOptions & { autoSelectFamily: boolean } = {
      method: route.request().method(),
      headers,
      agent: false,
      autoSelectFamily: false,
      lookup: (_host, _options, done) => done(null, address.address, address.family),
      // security: ignoreHTTPSErrors is needed by self-hosted render origins only.
      rejectUnauthorized: !own,
      timeout: 30_000,
    };
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, transportOptions, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 25 * 1024 * 1024) request.destroy(new Error('render asset too large'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        const result: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers))
          if (value !== undefined && !['transfer-encoding', 'connection'].includes(name))
            result[name] = Array.isArray(value) ? value.join('\n') : value;
        resolve({ status: response.statusCode ?? 502, headers: result, body: Buffer.concat(chunks) });
      });
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('render asset timed out')));
    request.end(route.request().postDataBuffer() ?? undefined);
  });
  await route.fulfill(body);
}

export async function guardRenderRequests(
  context: BrowserContext,
  origin: string,
  headers: Record<string, string>,
  policy?: RenderAssetPolicy,
  resolve?: Resolver,
) {
  await context.routeWebSocket('**/*', (socket) => socket.close());
  await context.route('**/*', async (route) => {
    try {
      const url = new URL(route.request().url());
      const address = await assetAddress(url, origin, policy, resolve);
      const requestHeaders = { ...route.request().headers() };
      delete requestHeaders['x-render-token'];
      if (url.origin === origin) Object.assign(requestHeaders, headers);
      await forward(route, url, address, requestHeaders, url.origin === origin);
    } catch {
      await route.abort('blockedbyclient').catch(() => undefined);
    }
  });
}

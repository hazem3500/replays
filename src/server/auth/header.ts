import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

import type { AuthAdapter, Identity } from './types.ts';

export interface HeaderAuthOptions {
  /** The header the proxy sets, e.g. `x-forwarded-email` (oauth2-proxy) or `remote-user`. */
  header: string;
  /** Optional second header with a display name. */
  nameHeader?: string;
  /**
   * Peer addresses (exact IPs or IPv4 CIDR ranges) allowed to set the header. A request from anywhere else is
   * refused even when it carries the header, so a client that reaches the app directly cannot impersonate a user.
   */
  trustedProxies: readonly string[];
  /** Optional allowlist of identities (exact, case-insensitive) or `@domain` suffixes. */
  allow?: readonly string[];
}

function ipv4ToInt(address: string) {
  return address.split('.').reduce((total, part) => total * 256 + Number(part), 0);
}

export function addressMatches(peer: string | undefined, entry: string) {
  if (!peer) return false;
  const address = peer.startsWith('::ffff:') ? peer.slice(7) : peer;
  const [network = '', bits] = entry.split('/');
  if (bits === undefined) return address === network || peer === network;
  if (isIP(address) !== 4 || isIP(network) !== 4) return false;
  const length = Number(bits);
  if (!Number.isInteger(length) || length < 0 || length > 32) return false;
  const mask = length === 0 ? 0 : (0xffffffff << (32 - length)) >>> 0;
  return (ipv4ToInt(address) & mask) >>> 0 === (ipv4ToInt(network) & mask) >>> 0;
}

function allowed(id: string, allow: readonly string[] | undefined) {
  if (!allow?.length) return true;
  const lower = id.toLowerCase();
  return allow.some((entry) => (entry.startsWith('@') ? lower.endsWith(entry.toLowerCase()) : lower === entry.toLowerCase()));
}

function first(request: IncomingMessage, name: string) {
  const value = request.headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim();
}

/** Trusts an identity header set by a reverse proxy that has already authenticated the user. */
export function headerAuth(options: HeaderAuthOptions): AuthAdapter {
  if (!options.header) throw new Error('header auth needs a header name (AUTH_HEADER)');
  if (!options.trustedProxies.length)
    throw new Error('header auth needs AUTH_TRUSTED_PROXIES (IPs or IPv4 CIDRs of the proxy); otherwise any client could set the header');
  const header = options.header.toLowerCase();
  const nameHeader = options.nameHeader?.toLowerCase();
  return {
    name: 'header',
    authenticate(request): Identity | undefined {
      if (!options.trustedProxies.some((entry) => addressMatches(request.socket.remoteAddress, entry))) return undefined;
      const id = first(request, header);
      if (!id || id.length > 254 || !allowed(id, options.allow)) return undefined;
      const name = nameHeader ? first(request, nameHeader) : undefined;
      return { id, ...(id.includes('@') ? { email: id } : {}), ...(name ? { name: name.slice(0, 120) } : {}) };
    },
  };
}

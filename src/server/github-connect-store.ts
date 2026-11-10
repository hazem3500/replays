import { createHash } from 'node:crypto';

import { type ObjectStorage, readJson } from './storage/types.ts';

const JSON_TYPE = 'application/json; charset=utf-8';
/** One replica's change reaches another's resolver within this long; this process's own writes apply at once. */
const CACHE_MS = 30_000;
const CACHE_MAX = 5000;

/** A GitHub account a person proved they own (GitHub's own `login`, as the OAuth callback read it). */
export interface GithubLink {
  login: string;
  /** An https avatar GitHub gave; used only when the host's identity has none. */
  avatarUrl?: string;
  linkedAt: string;
}

/** GitHub logins: 1 to 39 letters, digits or single hyphens inside. */
export const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;

/** Hash of the lowercased email: the storage key and the OAuth cookie's binding to the person who started. */
export const emailDigest = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);

const key = (email: string) => `_identity/github/${emailDigest(email)}.json`;

function valid(value: unknown): value is GithubLink {
  if (!value || typeof value !== 'object') return false;
  const login: unknown = Reflect.get(value, 'login');
  return typeof login === 'string' && GITHUB_LOGIN.test(login) && typeof Reflect.get(value, 'linkedAt') === 'string';
}

/**
 * Verified email to GitHub login links, one object per email on the storage interface (src/server/storage/), so any
 * driver holds them:
 *
 *   _identity/github/<sha256(email)[:32]>.json
 *
 * The identity resolver reads this on every request, so reads are cached for a short time and this process's own writes
 * update the cache at once.
 */
export class GithubLinkStore {
  private readonly storage: ObjectStorage;
  private readonly cache = new Map<string, { link: GithubLink | undefined; at: number }>();
  private readonly now: () => number;

  constructor(storage: ObjectStorage, now: () => number = Date.now) {
    this.storage = storage;
    this.now = now;
  }

  private remember(email: string, link?: GithubLink) {
    if (this.cache.size >= CACHE_MAX) this.cache.clear();
    this.cache.set(key(email), { link, at: this.now() });
  }

  async get(email: string): Promise<GithubLink | undefined> {
    const cached = this.cache.get(key(email));
    if (cached && this.now() - cached.at < CACHE_MS) return cached.link;
    const stored = await readJson(this.storage, key(email));
    const link = valid(stored) ? stored : undefined;
    this.remember(email, link);
    return link;
  }

  async set(email: string, link: GithubLink) {
    await this.storage.write(key(email), `${JSON.stringify(link)}\n`, { contentType: JSON_TYPE });
    this.remember(email, link);
  }

  async remove(email: string) {
    await this.storage.delete(key(email));
    this.remember(email);
  }
}

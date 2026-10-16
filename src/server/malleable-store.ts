import { createHash, randomBytes } from 'node:crypto';

import {
  MAX_VERSIONS,
  type PluginHistory,
  type PluginScope,
  type PluginSummary,
  type PluginVersion,
  type UserPluginManifest,
  USER_PLUGIN_HISTORY_FORMAT,
} from '../shared/malleable.ts';
import { ObjectExistsError, type ObjectStorage, PreconditionFailedError, readJson } from './storage/types.ts';

const JSON_TYPE = 'application/json; charset=utf-8';

export class PluginStoreError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'PluginStoreError';
    this.status = status;
  }
}

/** The digest an approval is bound to and a version records: the exact manifest and source, nothing else. */
export function contentDigest(manifest: UserPluginManifest, source: string) {
  return createHash('sha256')
    .update(JSON.stringify([manifest, source]))
    .digest('hex');
}

/**
 * Where the plugins live, on the storage interface (src/server/storage/), so any driver holds them:
 *
 *   _malleable/u/<sha256(identity)[:24]>/<id>.json    a person's plugins (only they list or read them)
 *   _malleable/w/<id>.json                            the workspace's plugins (everyone signed in sees and loads them)
 *
 * One object per plugin holds its whole history (`PluginHistory`, docs/formats/user-plugin-history.schema.json): a save
 * appends a version, nothing is ever rewritten, and "revert" is a save of an old version's content. Writes are
 * checked against the object's storage version, so two tabs (or replicas) never lose each other's save.
 */
export class UserPluginStore {
  private readonly storage: ObjectStorage;

  constructor(storage: ObjectStorage) {
    this.storage = storage;
  }

  private owner(scope: PluginScope, identity: string) {
    return scope === 'user' ? createHash('sha256').update(identity).digest('hex').slice(0, 24) : '';
  }

  private key(scope: PluginScope, identity: string, id: string) {
    return scope === 'user' ? `_malleable/u/${this.owner(scope, identity)}/${id}.json` : `_malleable/w/${id}.json`;
  }

  async list(scope: PluginScope, identity: string): Promise<PluginSummary[]> {
    const prefix = scope === 'user' ? `_malleable/u/${this.owner(scope, identity)}/` : '_malleable/w/';
    const objects = await this.storage.list({ prefix, glob: `${prefix}*.json` });
    const summaries = await Promise.all(
      objects.map(async (object): Promise<PluginSummary | undefined> => {
        const history = await readJson<PluginHistory>(this.storage, object.key);
        const latest = history?.versions?.at(-1);
        if (!history || !latest) return undefined;
        return { id: history.id, scope, name: latest.manifest.name, version: latest.n, updatedAt: latest.at, by: latest.by };
      }),
    );
    return summaries.filter((entry): entry is PluginSummary => Boolean(entry)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async history(scope: PluginScope, identity: string, id: string): Promise<PluginHistory | undefined> {
    return readJson<PluginHistory>(this.storage, this.key(scope, identity, id));
  }

  /**
   * Appends a version. `baseVersion` is the version the author started from (0 for a new plugin): saving over a newer one is
   * a 409 naming the current version, so a stale tab cannot overwrite.
   */
  async save(
    scope: PluginScope,
    identity: string,
    id: string,
    input: { manifest: UserPluginManifest; source: string; message: string; by: string; baseVersion: number },
    now = new Date(),
  ): Promise<PluginVersion> {
    if (input.manifest.id !== id) throw new PluginStoreError(400, 'the manifest id must match the plugin id');
    const key = this.key(scope, identity, id);
    for (let attempt = 1; ; attempt++) {
      const info = await this.storage.stat(key);
      const current = info ? await readJson<PluginHistory>(this.storage, key) : undefined;
      const latest = current?.versions.at(-1)?.n ?? 0;
      if (latest !== input.baseVersion)
        throw new PluginStoreError(409, `this plugin is at version ${latest} now; you started from ${input.baseVersion}. Reload it first.`);
      const version: PluginVersion = {
        n: latest + 1,
        at: now.toISOString(),
        by: input.by,
        message: input.message.slice(0, 200),
        manifest: input.manifest,
        source: input.source,
        sha256: contentDigest(input.manifest, input.source),
      };
      const history: PluginHistory = {
        format: USER_PLUGIN_HISTORY_FORMAT,
        id,
        versions: [...(current?.versions ?? []), version].slice(-MAX_VERSIONS),
      };
      try {
        await this.storage.write(key, `${JSON.stringify(history)}\n`, {
          contentType: JSON_TYPE,
          ...(info ? { ifVersion: info.version } : { createOnly: true }),
        });
        return version;
      } catch (error) {
        if (!(error instanceof PreconditionFailedError || error instanceof ObjectExistsError) || attempt >= 8) throw error;
        await new Promise((wait) => setTimeout(wait, Math.random() * 15 * attempt));
      }
    }
  }

  async remove(scope: PluginScope, identity: string, id: string) {
    return this.storage.delete(this.key(scope, identity, id));
  }
}

/**
 * Consent tokens for writes. The viewer asks for one only after the person clicked "Approve" in its dialog; the token is
 * bound to the person, the action and the exact content they were shown, works once, and expires. A write without one is
 * refused, so nothing but the dialog's own click can persist a plugin: not an agent on the bridge (which has no session),
 * not a plugin (which has no network), not a stray script that only knows the PUT route.
 */
export class ApprovalBook {
  private readonly tokens = new Map<string, { identity: string; digest: string; expires: number }>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(ttlMs = 2 * 60_000, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  static digest(action: 'save' | 'delete', scope: PluginScope, id: string, manifest?: UserPluginManifest, source?: string) {
    return createHash('sha256')
      .update(JSON.stringify([action, scope, id, manifest ?? null, source ?? null]))
      .digest('hex');
  }

  mint(identity: string, digest: string) {
    for (const [token, entry] of this.tokens) if (entry.expires <= this.now()) this.tokens.delete(token);
    if (this.tokens.size > 1000) throw new PluginStoreError(429, 'too many open approvals');
    const token = `ap_${randomBytes(18).toString('base64url')}`;
    this.tokens.set(token, { identity, digest, expires: this.now() + this.ttlMs });
    return { token, expiresInMs: this.ttlMs };
  }

  /** True once per token, for the same person and content. */
  consume(token: unknown, identity: string, digest: string) {
    if (typeof token !== 'string') return false;
    const entry = this.tokens.get(token);
    if (!entry) return false;
    this.tokens.delete(token);
    return entry.expires > this.now() && entry.identity === identity && entry.digest === digest;
  }
}

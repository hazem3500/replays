import { useSyncExternalStore } from 'react';

import { CAPABILITIES, type Capability, isCapability, isWriteCapability, type UserPluginManifest } from '../../shared/malleable.ts';
import { capabilityRule } from '../../shared/malleable-policy.ts';
import { createComment, fetchComments } from '../comments/api.ts';
import { queryClient } from '../queries.ts';
import { notify } from '../toast.ts';
import type { ViewerPluginContext } from '../plugins/api.ts';
import { hostPolicy } from './host.ts';

/*
 * The capability broker: the viewer's half of every call a sandboxed plugin makes. The frame can do nothing but send
 * `{ method, params }` over its port; this module decides. Four rules, in this order:
 *   1. a capability the manifest did not declare is refused (`permission-denied`), whatever the code says;
 *   2. a capability the host's policy denies (`malleable.capabilities`, src/shared/malleable-policy.ts) is refused too, and
 *      one it set to `ask` asks the person even if it is read-only;
 *   3. a `write` capability (comments:write, export:download) also needs the person's yes, asked with the exact thing about to
 *      happen, remembered only until the page reloads or the plugin's source changes;
 *   4. inputs are validated and size-limited here, so a plugin cannot hand the viewer anything it did not expect.
 */

export interface PluginRef {
  id: string;
  manifest: UserPluginManifest;
  source: string;
  log(level: string, message: string): void;
}

export interface PermissionRequest {
  key: number;
  plugin: string;
  pluginName: string;
  capability: Capability;
  label: string;
  /** What exactly will happen, in plain words. */
  detail: string;
  /** The text/content about to be written, shown verbatim. */
  preview?: string;
}

export type Decision = 'once' | 'session' | 'deny';

interface Waiting extends PermissionRequest {
  resolve(allowed: boolean): void;
  source: string;
}

class PermissionBook {
  private waiting: Waiting[] = [];
  private snapshotValue: readonly PermissionRequest[] = [];
  private readonly listeners = new Set<() => void>();
  /** plugin id → the source the grants were given for, and what was granted. */
  private readonly granted = new Map<string, { source: string; capabilities: Set<Capability> }>();
  private seq = 0;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = () => this.snapshotValue;

  private emit() {
    this.snapshotValue = this.waiting.map(({ resolve: _resolve, source: _source, ...request }) => request);
    for (const listener of this.listeners) listener();
  }

  isGranted(plugin: PluginRef, capability: Capability) {
    const grant = this.granted.get(plugin.id);
    return grant?.source === plugin.source && grant.capabilities.has(capability);
  }

  /** Asks (or answers from an earlier "for this page load"). Resolves false on deny. */
  request(plugin: PluginRef, capability: Capability, detail: string, preview?: string): Promise<boolean> {
    if (this.isGranted(plugin, capability)) return Promise.resolve(true);
    return new Promise((resolve) => {
      this.waiting.push({
        key: ++this.seq,
        plugin: plugin.id,
        pluginName: plugin.manifest.name,
        capability,
        label: CAPABILITIES[capability].label,
        detail,
        ...(preview === undefined ? {} : { preview }),
        resolve,
        source: plugin.source,
      });
      this.emit();
    });
  }

  decide(key: number, decision: Decision) {
    const entry = this.waiting.find((item) => item.key === key);
    if (!entry) return;
    const settle = (item: Waiting, allowed: boolean) => {
      this.waiting = this.waiting.filter((other) => other !== item);
      item.resolve(allowed);
    };
    if (decision === 'session') {
      const grant = this.granted.get(entry.plugin);
      if (grant?.source === entry.source) grant.capabilities.add(entry.capability);
      else this.granted.set(entry.plugin, { source: entry.source, capabilities: new Set([entry.capability]) });
      // Everything of the same kind that queued up behind this one is answered by the same yes.
      for (const other of this.waiting.filter(
        (item) => item.plugin === entry.plugin && item.capability === entry.capability && item.source === entry.source,
      ))
        settle(other, true);
    } else settle(entry, decision === 'once');
    this.emit();
  }

  /** A plugin was unloaded or reloaded: its open questions are no. */
  drop(plugin: string) {
    for (const item of this.waiting.filter((entry) => entry.plugin === plugin)) item.resolve(false);
    this.waiting = this.waiting.filter((entry) => entry.plugin !== plugin);
    this.emit();
  }

  grantedFor(plugin: Pick<PluginRef, 'id' | 'source'>): Capability[] {
    const grant = this.granted.get(plugin.id);
    return grant?.source === plugin.source ? [...grant.capabilities] : [];
  }

  /** Tests only. */
  reset() {
    this.waiting = [];
    this.granted.clear();
    this.emit();
  }
}

export const permissions = new PermissionBook();
export const usePermissionRequests = () => useSyncExternalStore(permissions.subscribe, permissions.getSnapshot);

const MAX_DOWNLOAD = 2 * 1024 * 1024;

export class BrokerError extends Error {}

function declared(plugin: PluginRef, capability: Capability) {
  if (!plugin.manifest.permissions.includes(capability))
    throw new BrokerError(`permission-denied: ${capability} is not in the manifest's permissions`);
}

/** Rules 1 and 2: declared, and not denied by the host (a read-only capability the host set to `ask` is asked here). */
async function check(plugin: PluginRef, capability: Capability) {
  declared(plugin, capability);
  const rule = capabilityRule(await hostPolicy(), capability);
  if (rule === 'deny') throw new BrokerError(`permission-denied: this server does not allow ${capability} for user plugins`);
  if (rule === 'ask' && !isWriteCapability(capability)) {
    const label = CAPABILITIES[capability].label;
    const allowed = await permissions.request(
      plugin,
      capability,
      `“${plugin.manifest.name}” wants to: ${label[0]!.toLowerCase()}${label.slice(1)}.`,
    );
    if (!allowed) throw new BrokerError('permission-denied: the person said no');
  }
}

/** Whether the frame may get its copy of the replay (`replay:read`, which is handed over at start rather than called). */
export async function mayReadReplay(plugin: PluginRef) {
  try {
    await check(plugin, 'replay:read');
    return true;
  } catch (error) {
    if (!(error instanceof BrokerError)) throw error;
    if (plugin.manifest.permissions.includes('replay:read')) plugin.log('warn', `replay:read: ${error.message}`);
    return false;
  }
}

function safeFileName(name: unknown) {
  const text = typeof name === 'string' ? name : '';
  const cleaned = text
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80);
  return cleaned || 'plugin-export.txt';
}

/** Handles one call from a plugin frame. Resolves with the (cloneable) result; throws to answer `{ ok: false }`. */
export async function handleCall(plugin: PluginRef, ctx: ViewerPluginContext, method: string, params: unknown): Promise<unknown> {
  const input = (params ?? {}) as Record<string, unknown>;
  switch (method) {
    case 'seek': {
      await check(plugin, 'playback:seek');
      if (typeof input.ms !== 'number' || !Number.isFinite(input.ms) || input.ms < 0)
        throw new BrokerError('seek(ms): ms must be a non-negative number');
      ctx.seek(input.ms);
      return null;
    }
    case 'notify': {
      await check(plugin, 'notify');
      notify(String(input.message ?? '').slice(0, 200));
      return null;
    }
    case 'comments.list': {
      await check(plugin, 'comments:read');
      const { comments } = await fetchComments(ctx.replay.meta.id);
      return comments.map((comment) => ({
        id: comment.id,
        ...(comment.at === undefined ? {} : { at: comment.at }),
        body: comment.body,
        author: { name: comment.author.name },
        ...(comment.resolved ? { resolved: true } : {}),
        ...(comment.parentId ? { parentId: comment.parentId } : {}),
      }));
    }
    case 'comments.add': {
      await check(plugin, 'comments:write');
      const body = typeof input.body === 'string' ? input.body.trim() : '';
      if (!body || body.length > 2000) throw new BrokerError('comments.add: body must be 1-2000 characters');
      if (input.at !== undefined && (typeof input.at !== 'number' || !Number.isFinite(input.at) || input.at < 0))
        throw new BrokerError('comments.add: at must be a non-negative number of ms');
      const at = typeof input.at === 'number' ? Math.round(input.at) : undefined;
      const allowed = await permissions.request(
        plugin,
        'comments:write',
        `“${plugin.manifest.name}” wants to add a comment${at === undefined ? ' to this replay' : ` at ${(at / 1000).toFixed(1)} s`}, in your name.`,
        body,
      );
      if (!allowed) throw new BrokerError('permission-denied: the person said no');
      const created = await createComment(ctx.replay.meta.id, { body, ...(at === undefined ? {} : { at }) });
      await queryClient.invalidateQueries({ queryKey: ['comments', ctx.replay.meta.id] });
      return { id: created.id };
    }
    case 'download': {
      await check(plugin, 'export:download');
      const text = typeof input.text === 'string' ? input.text : '';
      if (text.length > MAX_DOWNLOAD) throw new BrokerError('download: the file is larger than 2 MB');
      const name = safeFileName(input.name);
      const mime = typeof input.mime === 'string' && /^[a-z]+\/[\w.+-]+$/i.test(input.mime) ? input.mime : 'text/plain';
      const allowed = await permissions.request(
        plugin,
        'export:download',
        `“${plugin.manifest.name}” wants to download “${name}” (${(text.length / 1024).toFixed(1)} KB).`,
        text.slice(0, 600),
      );
      if (!allowed) throw new BrokerError('permission-denied: the person said no');
      const url = URL.createObjectURL(new Blob([text], { type: mime }));
      const anchor = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return null;
    }
    default:
      throw new BrokerError(`unknown method ${method}`);
  }
}

export { isCapability, isWriteCapability };

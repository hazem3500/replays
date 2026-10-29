/** Activity metadata only: no titles, URLs, recorded content, identities or query values. */
export interface ViewerEventMap {
  'replay:open': { readonly replayId: string };
  'tab:change': { readonly replayId: string; readonly tab: string };
  seek: { readonly replayId: string; readonly timeMs: number };
  'export:start': { readonly replayId: string; readonly format: string };
  'index:filter': { readonly activeCount: number };
}

export type ViewerEventName = keyof ViewerEventMap;
export type ViewerEventListener<K extends ViewerEventName> = (event: Readonly<ViewerEventMap[K]>) => void;
export type ViewerEvent = {
  [K in ViewerEventName]: { readonly type: K } & ViewerEventMap[K];
}[ViewerEventName];

type Entry<K extends ViewerEventName> = { key: symbol; owner: string; listener: ViewerEventListener<K> };
type Listeners = { [K in ViewerEventName]: Set<Entry<K>> };
const names: readonly ViewerEventName[] = ['replay:open', 'tab:change', 'seek', 'export:start', 'index:filter'];

/** Registry-owned subscriptions keep reloads transactional and never attach browser globals. */
export class ViewerEvents {
  private listeners: Listeners = {
    'replay:open': new Set(),
    'tab:change': new Set(),
    seek: new Set(),
    'export:start': new Set(),
    'index:filter': new Set(),
  };
  private readonly opened = new Map<symbol, string>();

  on<K extends ViewerEventName>(owner: string, type: K, listener: ViewerEventListener<K>): () => void {
    if (!Object.hasOwn(this.listeners, type) || typeof listener !== 'function') throw new TypeError('invalid viewer event subscription');
    const entry = { key: Symbol(), owner, listener };
    this.listeners[type].add(entry);
    if (type === 'replay:open') {
      for (const replayId of new Set(this.opened.values())) this.deliver('replay:open', { replayId }, entry.key);
    }
    return () => {
      this.listeners[type].delete(entry);
    };
  }

  open(replayId: string): () => void {
    const key = Symbol();
    const alreadyOpen = [...this.opened.values()].includes(replayId);
    this.opened.set(key, replayId);
    if (!alreadyOpen) this.deliver('replay:open', { replayId });
    return () => {
      this.opened.delete(key);
    };
  }

  emit(event: ViewerEvent): void {
    if (event.type === 'index:filter') {
      if (Number.isSafeInteger(event.activeCount) && event.activeCount >= 0) this.deliver(event.type, { activeCount: event.activeCount });
      return;
    }
    if (typeof event.replayId !== 'string' || !/^[a-z0-9-]{1,128}$/.test(event.replayId)) return;
    const { replayId } = event;
    switch (event.type) {
      case 'replay:open':
        this.deliver(event.type, { replayId });
        break;
      case 'tab:change':
        this.deliver(event.type, { replayId, tab: event.tab });
        break;
      case 'seek':
        if (Number.isFinite(event.timeMs) && event.timeMs >= 0) this.deliver(event.type, { replayId, timeMs: event.timeMs });
        break;
      case 'export:start':
        this.deliver(event.type, { replayId, format: event.format });
        break;
    }
  }

  private deliver<K extends ViewerEventName>(type: K, payload: ViewerEventMap[K], target?: symbol): void {
    const event = Object.freeze({ ...payload });
    // why: new observers join the next event, preventing reentrant registration loops.
    const observers = Array.from(this.listeners[type]);
    for (const entry of observers) {
      if (target !== undefined && entry.key !== target) continue;
      try {
        entry.listener(event);
      } catch {
        // why: observers must not interrupt playback or leak thrown plugin data to other observers.
      }
    }
  }

  removeOwner(owner: string): void {
    for (const type of names) this.removeFrom(type, owner);
  }

  private removeFrom<K extends ViewerEventName>(type: K, owner: string): void {
    for (const entry of this.listeners[type]) if (entry.owner === owner) this.listeners[type].delete(entry);
  }

  checkpoint(): Listeners {
    return {
      'replay:open': new Set(this.listeners['replay:open']),
      'tab:change': new Set(this.listeners['tab:change']),
      seek: new Set(this.listeners.seek),
      'export:start': new Set(this.listeners['export:start']),
      'index:filter': new Set(this.listeners['index:filter']),
    };
  }

  restore(listeners: Listeners): void {
    this.listeners = listeners;
  }
  reset(): void {
    for (const type of names) this.listeners[type].clear();
    this.opened.clear();
  }
}

import { bundleSpan } from '../shared/edits.ts';
import type { ReplayBundle } from '../shared/replay.ts';
import { firstPaintOffset, groupAt, renderOffset, snapshotGroups, type SnapshotGroup } from '../shared/snapshots.ts';
import { isRecord } from '../shared/validate.ts';

const EVENT_TYPES = ['DomContentLoaded', 'Load', 'FullSnapshot', 'IncrementalSnapshot', 'Meta', 'Custom', 'Plugin'];
const SOURCES = [
  'Mutation',
  'MouseMove',
  'MouseInteraction',
  'Scroll',
  'ViewportResize',
  'Input',
  'TouchMove',
  'MediaInteraction',
  'StyleSheetRule',
  'CanvasMutation',
  'Font',
  'Log',
  'Drag',
  'StyleDeclaration',
  'Selection',
  'AdoptedStyleSheet',
  'CustomElement',
];
const FULL_SNAPSHOT = 2;
const INCREMENTAL = 3;
const META = 4;
const MUTATION = 0;
const MEDIA_INTERACTION = 7;
const MEDIA_TAGS = new Set(['audio', 'video']);
const VIEWPORT_RESIZE = 4;
const ELEMENT_NODE = 2;

type Event = ReplayBundle['events'][number];
type Counts = Record<string, number>;

/** What the serialized page holds that the rrweb renderer treats specially. */
export interface DomCensus {
  nodes: number;
  elements: number;
  shadowRoots: number;
  iframes: number;
  canvases: number;
  customElements: number;
  styles: number;
  stylesheetLinks: number;
}

export interface InspectedDocument {
  index: number;
  start: number;
  snapshot: number;
  ready?: number;
  href?: string;
  dom: DomCensus;
}

/** What `ReplayController` hands rrweb for a paused frame at `time`, and what rrweb then applies on top of the rebuild. */
export interface InspectedMoment {
  time: number;
  /** The offset passed to `replayer.pause()`; at 0 it is the first paint's frame. */
  renderOffset: number;
  /** The document on screen (index into `documents`), or -1 before the first one. */
  document: number;
  href?: string;
  /** rrweb rebuilds from the last Meta event at or before the offset, not from our document groups. */
  rebuildFrom?: number;
  /** Events applied synchronously from that Meta up to the offset (exclusive). */
  applied: {
    events: number;
    byKind: Counts;
    mutations: { adds: number; removes: number; attributes: number; texts: number };
    /** Where those mutations land: the top page, a shadow root, or an embedded frame's document. */
    byPlace: Record<NodePlace, number>;
  };
  /** Mutations in that span naming a node the page does not have at that point: rrweb drops or fails on them. */
  missingNodes: number;
  /** The elements those mutations change most. */
  mostChanged: ChangedNode[];
  previousEvent?: { at: number; kind: string };
  nextEvent?: { at: number; kind: string };
}

/** A recorded media interaction and the element it names; rrweb can only replay those on `<audio>` and `<video>`. */
export interface InspectedMedia {
  at: number;
  id: number;
  tag: string;
  place?: NodePlace;
  /** False for anything but an audio or video element: the player drops it (src/client/playback/media-events.ts). */
  playable: boolean;
}

export interface Inspection {
  duration: number;
  recordedDuration: number;
  viewport: { width: number; height: number };
  capturedAt: string;
  source: string;
  formatVersion?: number;
  firstPaint: number;
  events: { total: number; byKind: Counts };
  documents: InspectedDocument[];
  metas: number[];
  resizes: Array<{ at: number; width: number; height: number }>;
  media: InspectedMedia[];
  moments: InspectedMoment[];
}

const typeName = (type: unknown) => (typeof type === 'number' ? (EVENT_TYPES[type] ?? `type ${type}`) : 'unknown');

/** `IncrementalSnapshot` events by their source (`Mutation`, `MouseMove`, ...), every other event by its type. */
function kindOf(event: Event) {
  if (event.type !== INCREMENTAL) return typeName(event.type);
  const source = isRecord(event.data) ? event.data.source : undefined;
  return typeof source === 'number' ? (SOURCES[source] ?? `source ${source}`) : 'IncrementalSnapshot';
}

const bump = (counts: Counts, key: string, by = 1) => {
  counts[key] = (counts[key] ?? 0) + by;
};

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const idOf = (value: unknown) => (isRecord(value) && typeof value.id === 'number' ? value.id : undefined);

/** Where a node lives: the top page, inside a shadow root, or inside an embedded frame's document. */
export type NodePlace = 'page' | 'shadow' | 'frame';

interface NodeInfo {
  parent: number;
  tag: string;
  place: NodePlace;
}

/** The ids, parents and places of the page rrweb holds, so mutations can be checked against it. */
class NodeTree {
  private readonly nodes = new Map<number, NodeInfo>();
  private readonly children = new Map<number, Set<number>>();
  private readonly top: number | undefined;

  constructor(root?: unknown) {
    this.top = idOf(root);
    if (root !== undefined) this.add(root, undefined);
  }

  get(id: number) {
    return this.nodes.get(id);
  }

  /** Adds a serialized node and its children; returns the census of what was added. */
  add(node: unknown, parent: number | undefined, census = emptyCensus()) {
    const id = idOf(node);
    if (!isRecord(node) || id === undefined) return census;
    const above = parent === undefined ? undefined : this.nodes.get(parent);
    const framed = above?.place === 'frame' || (typeof node.rootId === 'number' && node.rootId !== this.top);
    const place: NodePlace = framed ? 'frame' : above?.place === 'shadow' || node.isShadow === true ? 'shadow' : 'page';
    this.nodes.set(id, { parent: parent ?? -1, tag: typeof node.tagName === 'string' ? node.tagName.toLowerCase() : '#node', place });
    if (parent !== undefined) {
      const siblings = this.children.get(parent) ?? new Set<number>();
      siblings.add(id);
      this.children.set(parent, siblings);
    }
    count(node, census);
    for (const child of listOf(node.childNodes)) this.add(child, id, census);
    return census;
  }

  remove(id: number) {
    const parent = this.nodes.get(id)?.parent;
    if (parent !== undefined) this.children.get(parent)?.delete(id);
    const pending = [id];
    while (pending.length) {
      const next = pending.pop()!;
      this.nodes.delete(next);
      pending.push(...(this.children.get(next) ?? []));
      this.children.delete(next);
    }
  }
}

const emptyCensus = (): DomCensus => ({
  nodes: 0,
  elements: 0,
  shadowRoots: 0,
  iframes: 0,
  canvases: 0,
  customElements: 0,
  styles: 0,
  stylesheetLinks: 0,
});

function count(node: Record<string, unknown>, census: DomCensus) {
  census.nodes += 1;
  if (node.type !== ELEMENT_NODE || typeof node.tagName !== 'string') return;
  const tag = node.tagName.toLowerCase();
  census.elements += 1;
  if (node.isShadowHost === true) census.shadowRoots += 1;
  if (tag === 'iframe') census.iframes += 1;
  if (tag === 'canvas') census.canvases += 1;
  if (tag.includes('-')) census.customElements += 1;
  if (tag === 'style') census.styles += 1;
  const attributes = isRecord(node.attributes) ? node.attributes : {};
  if (tag === 'link' && attributes.rel === 'stylesheet') census.stylesheetLinks += 1;
}

const snapshotNode = (event: Event | undefined) => (isRecord(event?.data) ? event.data.node : undefined);

/** One element the applied span changes, by id; tag and attribute names only, never values. */
export interface ChangedNode {
  id: number;
  tag: string;
  place: NodePlace;
  changes: number;
  attributes: string[];
}

interface Applied {
  mutations: InspectedMoment['applied']['mutations'];
  byPlace: Record<NodePlace, number>;
  missingNodes: number;
  changed: Map<number, ChangedNode>;
}

const CHANGED_SHOWN = 8;

function touch(tree: NodeTree, applied: Applied, id: number, attributes: readonly string[] = []) {
  const info = tree.get(id);
  if (!info) return;
  applied.byPlace[info.place] += 1;
  const entry = applied.changed.get(id) ?? { id, tag: info.tag, place: info.place, changes: 0, attributes: [] };
  entry.changes += 1;
  for (const name of attributes) if (!entry.attributes.includes(name)) entry.attributes.push(name);
  applied.changed.set(id, entry);
}

/** Plays one mutation onto `tree` the way rrweb would, counting changes that name nodes it does not have. */
function applyMutation(tree: NodeTree, data: Record<string, unknown>, applied: Applied) {
  const { mutations } = applied;
  for (const removal of listOf(data.removes)) {
    mutations.removes += 1;
    const id = idOf(removal);
    const parent = isRecord(removal) && typeof removal.parentId === 'number' ? removal.parentId : undefined;
    if (id === undefined || !tree.get(id)) applied.missingNodes += 1;
    else {
      if (parent !== undefined) touch(tree, applied, parent);
      tree.remove(id);
    }
  }
  for (const addition of listOf(data.adds)) {
    mutations.adds += 1;
    const parent = isRecord(addition) && typeof addition.parentId === 'number' ? addition.parentId : undefined;
    if (parent === undefined || !tree.get(parent)) {
      applied.missingNodes += 1;
      continue;
    }
    touch(tree, applied, parent);
    tree.add(isRecord(addition) ? addition.node : undefined, parent);
  }
  for (const change of listOf(data.attributes)) {
    mutations.attributes += 1;
    const id = idOf(change);
    if (id === undefined || !tree.get(id)) applied.missingNodes += 1;
    else touch(tree, applied, id, isRecord(change) && isRecord(change.attributes) ? Object.keys(change.attributes) : []);
  }
  for (const change of listOf(data.texts)) {
    mutations.texts += 1;
    const id = idOf(change);
    if (id === undefined || !tree.get(id)) applied.missingNodes += 1;
    else touch(tree, applied, tree.get(id)!.parent);
  }
}

function moment(events: readonly Event[], groups: readonly SnapshotGroup[], time: number, firstPaint: number): InspectedMoment {
  const origin = events[0]?.timestamp ?? 0;
  const offset = renderOffset(groups, time === 0 ? firstPaint : time);
  const baseline = origin + offset;
  const group = groupAt(groups, time);
  let from = -1;
  for (let index = events.length - 1; index >= 0; index -= 1)
    if (events[index]!.type === META && events[index]!.timestamp <= baseline) {
      from = index;
      break;
    }
  const byKind: Counts = {};
  const applied: Applied = {
    mutations: { adds: 0, removes: 0, attributes: 0, texts: 0 },
    byPlace: { page: 0, shadow: 0, frame: 0 },
    missingNodes: 0,
    changed: new Map(),
  };
  let tree = new NodeTree();
  let total = 0;
  for (let index = Math.max(0, from); index < events.length && events[index]!.timestamp < baseline; index += 1) {
    const event = events[index]!;
    total += 1;
    bump(byKind, kindOf(event));
    if (event.type === FULL_SNAPSHOT) tree = new NodeTree(snapshotNode(event));
    else if (event.type === INCREMENTAL && isRecord(event.data) && event.data.source === MUTATION) applyMutation(tree, event.data, applied);
  }
  const nextIndex = events.findIndex((event) => event.timestamp >= baseline);
  const before = nextIndex === -1 ? events.at(-1) : events[nextIndex - 1];
  const after = nextIndex === -1 ? undefined : events[nextIndex];
  const documentIndex = group ? groups.indexOf(group) : -1;
  return {
    time,
    renderOffset: offset,
    document: documentIndex,
    ...(group?.href ? { href: group.href } : {}),
    ...(from >= 0 ? { rebuildFrom: events[from]!.timestamp - origin } : {}),
    applied: { events: total, byKind, mutations: applied.mutations, byPlace: applied.byPlace },
    missingNodes: applied.missingNodes,
    mostChanged: [...applied.changed.values()].sort((a, b) => b.changes - a.changes).slice(0, CHANGED_SHOWN),
    ...(before ? { previousEvent: { at: before.timestamp - origin, kind: kindOf(before) } } : {}),
    ...(after ? { nextEvent: { at: after.timestamp - origin, kind: kindOf(after) } } : {}),
  };
}

function mediaInteractions(events: readonly Event[], origin: number): InspectedMedia[] {
  const media: InspectedMedia[] = [];
  const ignored: Applied = {
    mutations: { adds: 0, removes: 0, attributes: 0, texts: 0 },
    byPlace: { page: 0, shadow: 0, frame: 0 },
    missingNodes: 0,
    changed: new Map(),
  };
  let tree = new NodeTree();
  for (const event of events) {
    if (!isRecord(event.data)) continue;
    if (event.type === FULL_SNAPSHOT) tree = new NodeTree(event.data.node);
    if (event.type !== INCREMENTAL) continue;
    if (event.data.source === MUTATION) applyMutation(tree, event.data, ignored);
    if (event.data.source !== MEDIA_INTERACTION || typeof event.data.id !== 'number') continue;
    const node = tree.get(event.data.id);
    const tag = node?.tag ?? 'unknown';
    media.push({
      at: event.timestamp - origin,
      id: event.data.id,
      tag,
      ...(node ? { place: node.place } : {}),
      playable: MEDIA_TAGS.has(tag),
    });
  }
  return media;
}

function resizes(events: readonly Event[], origin: number) {
  return events.flatMap((event) => {
    const data = isRecord(event.data) ? event.data : {};
    const sized = typeof data.width === 'number' && typeof data.height === 'number';
    const resize = (event.type === META || (event.type === INCREMENTAL && data.source === VIEWPORT_RESIZE)) && sized;
    return resize ? [{ at: event.timestamp - origin, width: Number(data.width), height: Number(data.height) }] : [];
  });
}

/**
 * The playback-relevant shape of a replay, computed the way the viewer's player does (src/client/playback/controller.ts):
 * its documents, first paint, and for each of `times` the offset a paused seek renders and what rrweb applies to get there.
 */
export function inspectReplay(bundle: ReplayBundle, times: readonly number[] = []): Inspection {
  const { events } = bundle;
  const origin = events[0]?.timestamp ?? 0;
  const duration = bundleSpan(bundle);
  const groups = snapshotGroups(events, bundle.network);
  const firstPaint = firstPaintOffset(bundle.performance, groups, duration);
  const byKind: Counts = {};
  for (const event of events) bump(byKind, kindOf(event));
  const snapshots = events.filter((event) => event.type === FULL_SNAPSHOT);
  return {
    duration,
    recordedDuration: bundle.meta.duration,
    viewport: bundle.meta.viewport,
    capturedAt: bundle.meta.capturedAt,
    source: bundle.meta.source ?? 'agent',
    ...(bundle.meta.formatVersion === undefined ? {} : { formatVersion: bundle.meta.formatVersion }),
    firstPaint,
    events: { total: events.length, byKind },
    documents: groups.map((group, index) => ({
      index,
      ...group,
      dom: new NodeTree().add(snapshotNode(snapshots[index]), undefined),
    })),
    metas: events.filter((event) => event.type === META).map((event) => event.timestamp - origin),
    resizes: resizes(events, origin),
    media: mediaInteractions(events, origin),
    moments: times.map((time) => moment(events, groups, Math.max(0, Math.min(time, duration)), firstPaint)),
  };
}

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

function countKinds(events: readonly Event[]): Counts {
  const counts: Counts = {};
  for (const event of events) {
    const kind = kindOf(event);
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const idOf = (value: unknown) => (isRecord(value) && typeof value.id === 'number' ? value.id : undefined);
const parentIdOf = (value: unknown) => (isRecord(value) && typeof value.parentId === 'number' ? value.parentId : undefined);

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

  /** Adds a serialized node and its children. */
  add(node: unknown, parent: number | undefined) {
    const id = idOf(node);
    if (!isRecord(node) || id === undefined) return;
    const above = parent === undefined ? undefined : this.nodes.get(parent);
    const tag = typeof node.tagName === 'string' ? node.tagName.toLowerCase() : '#node';
    this.nodes.set(id, { parent: parent ?? -1, tag, place: this.placeOf(node, above) });
    if (parent !== undefined) {
      const siblings = this.children.get(parent) ?? new Set<number>();
      siblings.add(id);
      this.children.set(parent, siblings);
    }
    for (const child of listOf(node.childNodes)) this.add(child, id);
  }

  remove(id: number) {
    const parent = this.nodes.get(id)?.parent;
    if (parent !== undefined) this.children.get(parent)?.delete(id);
    const pending = [id];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      this.nodes.delete(next);
      pending.push(...(this.children.get(next) ?? []));
      this.children.delete(next);
    }
  }

  private placeOf(node: Record<string, unknown>, above: NodeInfo | undefined): NodePlace {
    if (above?.place === 'frame' || (typeof node.rootId === 'number' && node.rootId !== this.top)) return 'frame';
    if (above?.place === 'shadow' || node.isShadow === true) return 'shadow';
    return 'page';
  }
}

/** The census keys one serialized node counts towards. */
function censusKeys(node: Record<string, unknown>): Array<keyof DomCensus> {
  if (node.type !== ELEMENT_NODE || typeof node.tagName !== 'string') return ['nodes'];
  const tag = node.tagName.toLowerCase();
  const attributes = isRecord(node.attributes) ? node.attributes : {};
  const flags: Array<[keyof DomCensus, boolean]> = [
    ['shadowRoots', node.isShadowHost === true],
    ['iframes', tag === 'iframe'],
    ['canvases', tag === 'canvas'],
    ['customElements', tag.includes('-')],
    ['styles', tag === 'style'],
    ['stylesheetLinks', tag === 'link' && attributes.rel === 'stylesheet'],
  ];
  return ['nodes', 'elements', ...flags.filter(([, on]) => on).map(([key]) => key)];
}

function censusOf(root: unknown): DomCensus {
  const census: DomCensus = {
    nodes: 0,
    elements: 0,
    shadowRoots: 0,
    iframes: 0,
    canvases: 0,
    customElements: 0,
    styles: 0,
    stylesheetLinks: 0,
  };
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (!isRecord(node) || idOf(node) === undefined) continue;
    for (const key of censusKeys(node)) census[key] += 1;
    pending.push(...listOf(node.childNodes));
  }
  return census;
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

const CHANGED_SHOWN = 8;

/** Plays snapshots and mutations onto a node tree the way rrweb would, counting changes that name nodes it does not have. */
class MutationReplay {
  tree = new NodeTree();
  readonly mutations = { adds: 0, removes: 0, attributes: 0, texts: 0 };
  readonly byPlace: Record<NodePlace, number> = { page: 0, shadow: 0, frame: 0 };
  missingNodes = 0;
  private readonly changed = new Map<number, ChangedNode>();

  play(event: Event) {
    if (event.type === FULL_SNAPSHOT) this.tree = new NodeTree(snapshotNode(event));
    else if (event.type === INCREMENTAL && isRecord(event.data) && event.data.source === MUTATION) this.mutate(event.data);
  }

  mostChanged() {
    return [...this.changed.values()].sort((a, b) => b.changes - a.changes).slice(0, CHANGED_SHOWN);
  }

  private mutate(data: Record<string, unknown>) {
    for (const removal of listOf(data.removes)) this.removal(removal);
    for (const addition of listOf(data.adds)) this.addition(addition);
    for (const change of listOf(data.attributes)) this.attributeChange(change);
    for (const change of listOf(data.texts)) this.textChange(change);
  }

  /** Whether the page has node `id`; counts it missing when not. */
  private known(id: number | undefined): id is number {
    const found = id !== undefined && this.tree.get(id) !== undefined;
    if (!found) this.missingNodes += 1;
    return found;
  }

  private removal(removal: unknown) {
    this.mutations.removes += 1;
    const id = idOf(removal);
    if (!this.known(id)) return;
    const parent = parentIdOf(removal);
    if (parent !== undefined) this.touch(parent);
    this.tree.remove(id);
  }

  private addition(addition: unknown) {
    this.mutations.adds += 1;
    const parent = parentIdOf(addition);
    if (!this.known(parent)) return;
    this.touch(parent);
    this.tree.add(isRecord(addition) ? addition.node : undefined, parent);
  }

  private attributeChange(change: unknown) {
    this.mutations.attributes += 1;
    const id = idOf(change);
    if (!this.known(id)) return;
    this.touch(id, isRecord(change) && isRecord(change.attributes) ? Object.keys(change.attributes) : []);
  }

  private textChange(change: unknown) {
    this.mutations.texts += 1;
    const id = idOf(change);
    if (!this.known(id)) return;
    const parent = this.tree.get(id)?.parent;
    if (parent !== undefined) this.touch(parent);
  }

  private touch(id: number, attributes: readonly string[] = []) {
    const info = this.tree.get(id);
    if (!info) return;
    this.byPlace[info.place] += 1;
    const entry = this.changed.get(id) ?? { id, tag: info.tag, place: info.place, changes: 0, attributes: [] };
    entry.changes += 1;
    for (const name of attributes) if (!entry.attributes.includes(name)) entry.attributes.push(name);
    this.changed.set(id, entry);
  }
}

/** The index of the last Meta event at or before `baseline`, which rrweb rebuilds from; -1 when there is none. */
function rebuildIndex(events: readonly Event[], baseline: number) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === META && event.timestamp <= baseline) return index;
  }
  return -1;
}

function neighbours(events: readonly Event[], baseline: number, origin: number) {
  const next = events.findIndex((event) => event.timestamp >= baseline);
  const before = next === -1 ? events.at(-1) : events[next - 1];
  const after = next === -1 ? undefined : events[next];
  const describe = (event: Event) => ({ at: event.timestamp - origin, kind: kindOf(event) });
  return { ...(before ? { previousEvent: describe(before) } : {}), ...(after ? { nextEvent: describe(after) } : {}) };
}

function moment(events: readonly Event[], groups: readonly SnapshotGroup[], time: number, firstPaint: number): InspectedMoment {
  const origin = events[0]?.timestamp ?? 0;
  const offset = renderOffset(groups, time === 0 ? firstPaint : time);
  const baseline = origin + offset;
  const group = groupAt(groups, time);
  const from = rebuildIndex(events, baseline);
  const start = Math.max(0, from);
  const stop = events.findIndex((event, index) => index >= start && event.timestamp >= baseline);
  const span = events.slice(start, stop === -1 ? events.length : stop);
  const replay = new MutationReplay();
  for (const event of span) replay.play(event);
  const rebuild = events[from];
  return {
    time,
    renderOffset: offset,
    document: group ? groups.indexOf(group) : -1,
    ...(group?.href ? { href: group.href } : {}),
    ...(rebuild ? { rebuildFrom: rebuild.timestamp - origin } : {}),
    applied: { events: span.length, byKind: countKinds(span), mutations: replay.mutations, byPlace: replay.byPlace },
    missingNodes: replay.missingNodes,
    mostChanged: replay.mostChanged(),
    ...neighbours(events, baseline, origin),
  };
}

function mediaInteractions(events: readonly Event[], origin: number): InspectedMedia[] {
  const replay = new MutationReplay();
  return events.flatMap((event) => {
    replay.play(event);
    const data = isRecord(event.data) ? event.data : {};
    if (event.type !== INCREMENTAL || data.source !== MEDIA_INTERACTION || typeof data.id !== 'number') return [];
    const node = replay.tree.get(data.id);
    const tag = node?.tag ?? 'unknown';
    return [{ at: event.timestamp - origin, id: data.id, tag, ...(node ? { place: node.place } : {}), playable: MEDIA_TAGS.has(tag) }];
  });
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
  const snapshots = events.filter((event) => event.type === FULL_SNAPSHOT);
  return {
    duration,
    recordedDuration: bundle.meta.duration,
    viewport: bundle.meta.viewport,
    capturedAt: bundle.meta.capturedAt,
    source: bundle.meta.source ?? 'agent',
    ...(bundle.meta.formatVersion === undefined ? {} : { formatVersion: bundle.meta.formatVersion }),
    firstPaint,
    events: { total: events.length, byKind: countKinds(events) },
    documents: groups.map((group, index) => ({
      index,
      ...group,
      dom: censusOf(snapshotNode(snapshots[index])),
    })),
    metas: events.filter((event) => event.type === META).map((event) => event.timestamp - origin),
    resizes: resizes(events, origin),
    media: mediaInteractions(events, origin),
    moments: times.map((time) => moment(events, groups, Math.max(0, Math.min(time, duration)), firstPaint)),
  };
}

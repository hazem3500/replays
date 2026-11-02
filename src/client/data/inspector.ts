import { bundleSpan, editTimeline, type EditTimeline } from '../../shared/edits.ts';
import type { ConsoleLevel, ReplayBundle, ReplayConsoleEntry, ReplayPerformanceKind } from '../../shared/replay.ts';
import { buildNetworkRows, type NetworkRow, type RequestType, type StatusClass } from '../viewer/network/model.ts';
import { BUDGET_FOR_KIND, DEFAULT_BUDGETS, type Verdict, verdictFor } from '../viewer/performance/budgets.ts';
import { buildPerformance, type PerformanceSignal } from '../viewer/performance.ts';
import { validDuration } from '../viewer/waterfall.ts';

export type InspectorTab = 'console' | 'network' | 'performance';

/** What a table's toolbar narrows to: every key optional, AND across keys, OR within a list. */
export interface InspectorFilter {
  /** Words that must all appear (any case). */
  text?: string | undefined;
  /** Player-clock ms (the timing brush). */
  range?: { from: number; to: number } | undefined;
  levels?: readonly ConsoleLevel[] | undefined;
  statuses?: readonly StatusClass[] | undefined;
  types?: readonly RequestType[] | undefined;
  methods?: readonly string[] | undefined;
  kinds?: readonly ReplayPerformanceKind[] | undefined;
  verdicts?: readonly Verdict[] | undefined;
}

/** A console entry on the player's clock (edited timeline), with a stable id for selection and virtual keys. */
export interface ConsoleRow {
  id: string;
  index: number;
  entry: ReplayConsoleEntry;
  at: number;
  sourceAt: number;
  level: ConsoleLevel;
  haystack: string;
}
export type InspectorNetworkRow = NetworkRow & { method: string; haystack: string };
export type InspectorPerformanceRow = PerformanceSignal & { performanceKind: ReplayPerformanceKind; verdict?: Verdict; haystack: string };

/** Every row type by tab. */
export interface InspectorRows {
  console: ConsoleRow;
  network: InspectorNetworkRow;
  performance: InspectorPerformanceRow;
}

function consoleRows(bundle: ReplayBundle, timeline: EditTimeline): ConsoleRow[] {
  return bundle.console.flatMap((entry, index) => {
    if (!Number.isFinite(entry.at) || entry.at < 0 || timeline.isRemoved(entry.at)) return [];
    const haystack = `${entry.message} ${entry.url ?? ''}`.toLowerCase();
    return [{ id: `console-${index}`, index, entry, at: timeline.toEdited(entry.at), sourceAt: entry.at, level: entry.level, haystack }];
  });
}

function networkRows(bundle: ReplayBundle, timeline: EditTimeline): InspectorNetworkRow[] {
  return buildNetworkRows(bundle, timeline).map((row) => ({
    ...row,
    method: row.entry.method.toUpperCase(),
    haystack: `${row.entry.method} ${row.entry.url} ${row.entry.status} ${row.entry.statusText}`.toLowerCase(),
  }));
}

function performanceRows(bundle: ReplayBundle, timeline: EditTimeline): InspectorPerformanceRow[] {
  return buildPerformance(bundle, timeline).signals.map((row) => ({
    ...row,
    performanceKind: row.entry.kind,
    ...(validDuration(row.entry.value) ? { verdict: verdictFor(row.entry.value, DEFAULT_BUDGETS[BUDGET_FOR_KIND[row.entry.kind]]) } : {}),
    haystack: `${row.label} ${row.entry.eventType ?? ''}`.toLowerCase(),
  }));
}

interface Built {
  console?: ConsoleRow[];
  network?: InspectorNetworkRow[];
  performance?: InspectorPerformanceRow[];
}

/** Rows per bundle (immutable) and timeline object: a new edit list builds new rows, and old ones are collected. */
const built = new WeakMap<ReplayBundle, WeakMap<object, Built>>();
const NO_EDITS = {};

function rowsOf(bundle: ReplayBundle, timeline: EditTimeline | undefined): Built {
  const byTimeline = built.get(bundle) ?? new WeakMap<object, Built>();
  built.set(bundle, byTimeline);
  const scope = timeline ?? NO_EDITS;
  const rows = byTimeline.get(scope) ?? {};
  byTimeline.set(scope, rows);
  return rows;
}

const timelineOf = (bundle: ReplayBundle, timeline: EditTimeline | undefined) => timeline ?? editTimeline(undefined, bundleSpan(bundle));

/** The console tab's rows, in time order, built once per bundle and timeline. */
export function inspectorConsoleRows(bundle: ReplayBundle, timeline?: EditTimeline) {
  const rows = rowsOf(bundle, timeline);
  rows.console ??= consoleRows(bundle, timelineOf(bundle, timeline));
  return rows.console;
}

/** The network tab's rows (NetworkRow plus an upper-case method), in start order, built once per bundle and timeline. */
export function inspectorNetworkRows(bundle: ReplayBundle, timeline?: EditTimeline) {
  const rows = rowsOf(bundle, timeline);
  rows.network ??= networkRows(bundle, timelineOf(bundle, timeline));
  return rows.network;
}

/** The performance tab's signals with their budget verdict, built once per bundle and timeline. */
export function inspectorPerformanceRows(bundle: ReplayBundle, timeline?: EditTimeline) {
  const rows = rowsOf(bundle, timeline);
  rows.performance ??= performanceRows(bundle, timelineOf(bundle, timeline));
  return rows.performance;
}

const allowed = <T>(values: readonly T[] | undefined, value: T | undefined) =>
  !values?.length || (value !== undefined && values.includes(value));

function common(row: { at: number; haystack: string }, filter: InspectorFilter) {
  if (filter.range && (row.at < filter.range.from || row.at > filter.range.to)) return false;
  const words = (filter.text ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => row.haystack.includes(word));
}

/** Console rows matching `filter` (levels, text, range). */
export function filterConsoleRows(rows: readonly ConsoleRow[], filter: InspectorFilter) {
  return rows.filter((row) => allowed(filter.levels, row.level) && common(row, filter));
}

/** Network rows matching `filter` (status classes, request types, methods in any case, text, range). */
export function filterNetworkRows(rows: readonly InspectorNetworkRow[], filter: InspectorFilter) {
  const methods = filter.methods?.map((method) => method.toUpperCase());
  return rows.filter(
    (row) => allowed(filter.statuses, row.status) && allowed(filter.types, row.type) && allowed(methods, row.method) && common(row, filter),
  );
}

/** Performance rows matching `filter` (kinds, verdicts, text, range). */
export function filterPerformanceRows(rows: readonly InspectorPerformanceRow[], filter: InspectorFilter) {
  return rows.filter((row) => allowed(filter.kinds, row.performanceKind) && allowed(filter.verdicts, row.verdict) && common(row, filter));
}

interface Selected<Row> {
  rows: Row[];
  /** Rows before filtering. */
  total: number;
}

/**
 * A tab's rows matching `filter`, in time order (the panels' entry point). Plain functions, measured faster than a live
 * query for a filter that changes on each keystroke (.review-artifacts/tanstack-db/perf): rows are built once per bundle
 * and timeline, filtering is a pass over them, and the React Compiler memoizes the call.
 */
export function useInspectorRows(bundle: ReplayBundle, tab: 'console', filter?: InspectorFilter, timeline?: EditTimeline): Selected<ConsoleRow>;
export function useInspectorRows(
  bundle: ReplayBundle,
  tab: 'network',
  filter?: InspectorFilter,
  timeline?: EditTimeline,
): Selected<InspectorNetworkRow>;
export function useInspectorRows(
  bundle: ReplayBundle,
  tab: 'performance',
  filter?: InspectorFilter,
  timeline?: EditTimeline,
): Selected<InspectorPerformanceRow>;
export function useInspectorRows(bundle: ReplayBundle, tab: InspectorTab, filter: InspectorFilter = {}, timeline?: EditTimeline) {
  if (tab === 'console') {
    const all = inspectorConsoleRows(bundle, timeline);
    return { rows: filterConsoleRows(all, filter), total: all.length };
  }
  if (tab === 'network') {
    const all = inspectorNetworkRows(bundle, timeline);
    return { rows: filterNetworkRows(all, filter), total: all.length };
  }
  const all = inspectorPerformanceRows(bundle, timeline);
  return { rows: filterPerformanceRows(all, filter), total: all.length };
}

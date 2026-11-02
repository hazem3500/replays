import type { Verdict } from './budgets.ts';

/*
 * The diagnosis of a replay: what went wrong, the evidence that links it, and the layer it most likely belongs to.
 * Plain JSON (references are ids and indexes into the bundle), so the CLI and the MCP bridge can print it as is.
 */

export type IssueKind = 'failed-request' | 'console-error' | 'slow-interaction' | 'long-task' | 'slow-request' | 'slow-paint';
/** `failure`: something broke (a failed request, an error). `poor` / `needs-improvement`: it worked, slowly. */
export type IssueSeverity = 'failure' | 'poor' | 'needs-improvement';
export type IssueLayer = 'frontend' | 'backend' | 'network';

/** A row in the bundle: `index` is the position in `steps`, `console` or `performance.entries`; requests use their id. */
export type EvidenceRef =
  | { kind: 'step'; index: number }
  | { kind: 'request'; id: string }
  | { kind: 'console'; index: number }
  | { kind: 'performance'; index: number };

export type IssueLinkRole = 'trigger' | 'cause' | 'effect' | 'retry' | 'next' | 'context';

/** One link in the causal chain, in time order. */
export interface IssueLink {
  ref: EvidenceRef;
  role: IssueLinkRole;
  /** Player clock (edited when a timeline is given), ms. */
  at: number;
  label: string;
  detail?: string;
  tone?: 'bad' | 'warn' | 'ok';
}

export interface Issue {
  /** Stable across runs on the same bundle: `<kind>:<row>`. */
  id: string;
  kind: IssueKind;
  severity: IssueSeverity;
  layer: IssueLayer;
  /** One line: what happened, naming the action when there is one. */
  title: string;
  /** Shorter, for marks and badges. */
  short: string;
  /** Why it is probably this layer, and what was not captured. */
  reason: string;
  /** Player clock, ms. */
  at: number;
  end: number;
  /** Captured (source) time of the primary row, ms. */
  sourceAt: number;
  /** The row "Open in Network / Performance / Console" selects. */
  primary: EvidenceRef;
  /** The action that led to it, when there is one. */
  trigger?: EvidenceRef;
  chain: IssueLink[];
  /** The measured value for slow issues (ms), with its verdict. */
  value?: number;
  verdict?: Verdict;
}

export interface DetectOptions {
  budgets?: import('./budgets.ts').Budgets;
  /** A request is slow at this many times its host's median of successful requests… */
  slowRequestFactor?: number;
  /** …and never under this, ms. */
  slowRequestMinimum?: number;
  /** Console lines this long after a failed request ends belong to it, ms. */
  consoleWindow?: number;
  /** An action this long before something can still be its trigger, ms. */
  triggerWindow?: number;
}

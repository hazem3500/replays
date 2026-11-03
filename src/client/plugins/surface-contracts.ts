import type { ReplayEdits } from '../../shared/edits.ts';
import type { ReplayBundle, ReplayNetworkEntry } from '../../shared/replay.ts';

/** Host contributions receive readonly data views and explicit commands rather than application stores. */
export interface HostSurfaceContext {
  readonly replay?: Readonly<ReplayBundle>;
  readonly edits?: Readonly<ReplayEdits>;
  readonly duration?: number;
  readonly selection?: { readonly kind: string; readonly id?: string };
  readonly request?: Readonly<ReplayNetworkEntry>;
  readonly stacked?: boolean;
  readonly scale?: { readonly width: number; x(time: number): number; timeAt(clientX: number): number };
  seek?(time: number): void;
  changeEdits?(edits: ReplayEdits): void;
}

/** Framework-neutral content for a host slot; cleanup runs before replacement and on unmount. */
export interface HostSurfaceDefinition<C extends HostSurfaceContext = HostSurfaceContext> {
  readonly label: string;
  /** Network columns accept a CSS grid track size, for example `100px` or `minmax(80px, 1fr)`. */
  readonly width?: string;
  render(container: HTMLElement, context: C): void | (() => void);
}

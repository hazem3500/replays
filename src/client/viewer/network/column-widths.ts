import type { NetworkColumnKey } from './columns.ts';

export type ResizableColumn = Exclude<NetworkColumnKey, 'request'>;

interface Limits {
  initial: number;
  min: number;
  max: number;
}

/** Pixel widths of the fixed columns on a wide panel; Request takes whatever is left. */
export const COLUMN_LIMITS: Record<ResizableColumn, Limits> = {
  time: { initial: 60, min: 48, max: 160 },
  status: { initial: 52, min: 40, max: 120 },
  duration: { initial: 116, min: 80, max: 300 },
  during: { initial: 200, min: 80, max: 400 },
};

export type ColumnWidths = Partial<Record<ResizableColumn, number>>;

export const widthOf = (widths: ColumnWidths, key: ResizableColumn) => widths[key] ?? COLUMN_LIMITS[key].initial;

/** `key` made `delta` px wider (narrower when negative), kept within its limits. */
export function resizeColumn(widths: ColumnWidths, key: ResizableColumn, delta: number): ColumnWidths {
  const { min, max } = COLUMN_LIMITS[key];
  return { ...widths, [key]: Math.min(max, Math.max(min, Math.round(widthOf(widths, key) + delta))) };
}

/** The grid template of the five built-in columns with these widths. */
export function columnTemplate(widths: ColumnWidths) {
  return `${widthOf(widths, 'time')}px minmax(0, 1fr) ${widthOf(widths, 'status')}px ${widthOf(widths, 'duration')}px ${widthOf(widths, 'during')}px`;
}

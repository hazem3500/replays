/**
 * Holds the height of the rows outside a windowed list's rendered range. It is inert (no hover, focus, selection or
 * accessible row), so an empty band never reads as a log line or request.
 */
export function ListSpacer({ height }: { height: number }) {
  return <div className="list-spacer" aria-hidden="true" inert style={{ height, pointerEvents: 'none', userSelect: 'none' }} />;
}

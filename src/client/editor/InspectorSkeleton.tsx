/**
 * The side panel while the editor loads: the cursor panel's own header, then its rows as placeholders in the same
 * box and rhythm, so nothing moves when the real panel replaces it. Dependency-free so the loading shell can render
 * it before the editor chunk arrives.
 */
export function InspectorSkeleton() {
  return (
    <div className="inspector-skeleton" aria-hidden="true" data-testid="inspector-skeleton">
      <span className="inspector-skeleton-header">
        <strong>Cursor</strong>
        <small>Applies to the whole replay</small>
      </span>
      <span className="skeleton inspector-skeleton-row" />
      <span className="inspector-skeleton-grid" data-columns="3">
        {['a', 'b', 'c', 'd', 'e', 'f'].map((key) => (
          <span key={key} className="skeleton inspector-skeleton-card" />
        ))}
      </span>
      <span className="skeleton inspector-skeleton-row" />
      <span className="inspector-skeleton-grid">
        {['g', 'h', 'i', 'j'].map((key) => (
          <span key={key} className="skeleton inspector-skeleton-card" />
        ))}
      </span>
    </div>
  );
}

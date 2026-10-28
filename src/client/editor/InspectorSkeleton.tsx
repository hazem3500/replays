/**
 * The side panel while the editor loads: the cursor settings' own rows as placeholders, in the same box and rhythm,
 * so nothing moves when the real panel replaces it. Dependency-free so the loading shell can render it before the
 * editor chunk arrives.
 */
export function InspectorSkeleton() {
  return (
    <div className="inspector-skeleton" aria-hidden="true" data-testid="inspector-skeleton">
      <span className="skeleton inspector-skeleton-title" />
      <span className="skeleton inspector-skeleton-row" />
      <span className="inspector-skeleton-grid">
        {['a', 'b', 'c', 'd', 'e', 'f'].map((key) => (
          <span key={key} className="skeleton inspector-skeleton-card" />
        ))}
      </span>
      <span className="skeleton inspector-skeleton-row" />
      <span className="skeleton skeleton-thin inspector-skeleton-track" />
      <span className="skeleton inspector-skeleton-row" />
      <span className="skeleton inspector-skeleton-row" />
    </div>
  );
}

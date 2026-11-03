/** The collapsed cursor disclosure while the opted-in editor loads. */
export function InspectorSkeleton() {
  return (
    <div className="cursor-inspector inspector-skeleton" aria-hidden="true" inert data-testid="inspector-skeleton">
      <div className="cursor-disclosure">Cursor</div>
    </div>
  );
}

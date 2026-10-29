import { SKELETON_CLICKS, SKELETON_MOTIONS, SKELETON_STYLES } from './skeleton-copy.ts';

const SWATCHES = 7;

/**
 * The side panel while the editor loads: the cursor panel's own markup and classes (cursor-inspector.css is eager),
 * its headings, card names and controls drawn disabled, so the real panel replaces it without anything moving.
 * Dependency-free so the loading shell can render it before the editor chunk arrives.
 */
export function InspectorSkeleton() {
  return (
    <div className="cursor-inspector inspector-skeleton" aria-hidden="true" inert data-testid="inspector-skeleton">
      <header className="cursor-inspector-header">
        <div className="cursor-inspector-title">
          <h2>Cursor</h2>
          <p>Applies to the whole replay</p>
        </div>
        <span className="inspector-skeleton-reset">Reset</span>
      </header>
      <p className="cursor-recipe">
        <span className="skeleton inspector-skeleton-line" />
      </p>
      <div className="cursor-row">
        <span className="cursor-row-label">Show cursor</span>
        <span className="ui-switch" data-checked="" data-disabled="">
          <span className="ui-switch-thumb" />
        </span>
      </div>
      <div className="cursor-options">
        <section className="cursor-section">
          <span className="cursor-section-label">Style</span>
          <span className="cursor-style-grid">
            {SKELETON_STYLES.map((name, index) => (
              <span key={name} className="cursor-style-option" data-checked={index === 0 ? '' : undefined}>
                <span className="cursor-style-well" />
                <span className="cursor-style-name">{name}</span>
              </span>
            ))}
          </span>
          <p className="cursor-motion-description">
            <span className="skeleton" />
          </p>
          <span className="cursor-section-label cursor-color-label">Color</span>
          <span className="cursor-color-row">
            {Array.from({ length: SWATCHES }, (_, index) => (
              <span key={index} className="cursor-color-swatch" data-default={index === 0 ? '' : undefined} />
            ))}
          </span>
        </section>
        <section className="cursor-section">
          <span className="cursor-section-label">Motion</span>
          <span className="cursor-motion-grid">
            {SKELETON_MOTIONS.map((name, index) => (
              <span key={name} className="cursor-motion-option" data-checked={index === 0 ? '' : undefined}>
                <span className="cursor-motion-preview" />
                <span className="cursor-motion-name">{name}</span>
              </span>
            ))}
          </span>
          <p className="cursor-motion-description">
            <span className="skeleton" />
          </p>
        </section>
        <section className="cursor-section">
          <span className="cursor-section-label">Click</span>
          <span className="ui-segmented cursor-click-choices">
            {SKELETON_CLICKS.map((name) => (
              <span key={name} className="ui-segment">
                {name}
              </span>
            ))}
          </span>
        </section>
      </div>
    </div>
  );
}

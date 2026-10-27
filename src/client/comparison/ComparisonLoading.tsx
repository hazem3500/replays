import { Component, type ReactNode } from 'react';
import { Topbar } from '../Topbar.tsx';
import { indexReturnHref } from '../route.ts';
import './comparison.css';

/** Eager, provider-free frame: a slow player chunk must not erase the whole workspace. */
export function ComparisonLoading() {
  return (
    <main className="cmp-workspace cmp-replay cmp-loading" aria-label="Replay comparison">
      <Topbar title="Compare recordings" prefix="Compare" backHref={indexReturnHref()} compact />
      <div className="cmp-stages">
        {['A · Before', 'B · After'].map((label) => (
          <section key={label} className="cmp-side" aria-label={label} aria-busy="true">
            <header>
              <h2>{label}</h2>
            </header>
            <div className="cmp-stage cmp-loading-stage">
              <span role="status">Preparing player</span>
            </div>
          </section>
        ))}
      </div>
      <section className="cmp-transport" aria-label="Shared playback controls">
        <button type="button" disabled>
          Play
        </button>
        <p className="cmp-help">Playback becomes available as recordings load.</p>
      </section>
    </main>
  );
}

/** Failed code downloads need an exit and recovery, rather than a blank comparison. */
export class ComparisonLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="cmp-workspace">
        <a href={indexReturnHref()}>← Replays</a>
        <h1>Comparison could not load</h1>
        <p role="alert">The comparison player could not be downloaded. Reload to try again.</p>
        <button type="button" onClick={() => location.reload()}>
          Reload comparison
        </button>
      </main>
    );
  }
}

import { Component, type ReactNode } from 'react';
import { indexReturnHref } from '../route.ts';
import './comparison.css';
import { MeetingShell } from './meeting/MeetingShell.tsx';

/** Eager, provider-free frame: the meeting view's own chrome with calm tiles until its code and recordings arrive. */
export function ComparisonLoading() {
  return <MeetingShell />;
}

/** Failed code downloads need an exit and recovery, rather than a blank comparison. */
export class ComparisonLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
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

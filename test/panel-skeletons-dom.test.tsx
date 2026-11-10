// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SKELETON_DELAY_MS } from '@/components/ui/skeleton.tsx';
import { PanelSkeleton } from '@/viewer/PanelSkeletons.tsx';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

const flush = (work: () => void) => void act(work);

let host: HTMLDivElement;
let root: Root;

function render(panel: string) {
  flush(() => root.render(<PanelSkeleton panel={panel} />));
  return host.querySelector<HTMLElement>('[data-testid="panel-pending"]');
}
const count = (selector: string) => host.querySelectorAll(selector).length;

describe('panel skeletons', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    flush(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it('performance mirrors the headline, timeline lanes, stats pills and table rows', () => {
    render('performance');
    expect(count('.sk-lead .skel')).toBe(3);
    expect(count('.sk-tl-gutter .sk-lane')).toBe(3);
    expect(count('.sk-tl-plot .sk-lane')).toBe(3);
    expect(count('.sk-vitals li')).toBe(5);
    expect(count('.sk-table .sk-row:not(.sk-head)')).toBe(5);
    expect(count('.sk-table .sk-row:not(.sk-head) .sk-md')).toBe(5);
  });

  it('network mirrors the filter pills, timeline lanes and request rows', () => {
    render('network');
    expect(count('.sk-toolbar .skel[data-shape="pill"]')).toBe(4);
    expect(count('.sk-tl-plot .sk-lane')).toBe(2);
    expect(count('.sk-table .sk-row:not(.sk-head)')).toBe(7);
    expect(count('.sk-table .sk-row:not(.sk-head) .sk-cell')).toBe(14);
  });

  it('console mirrors the chips and log lines with a level dot each', () => {
    render('console');
    expect(count('.sk-toolbar .skel')).toBe(4);
    expect(count('.sk-table .sk-row:not(.sk-head)')).toBe(6);
    expect(count('.sk-table .sk-cell .skel[data-shape="dot"]')).toBe(6);
  });

  it('context mirrors the summary, sources and two columns of label and value rows', () => {
    render('context');
    expect(count('.sk-ctx-summary .skel')).toBe(3);
    expect(count('.sk-ctx-source')).toBe(2);
    expect(count('.sk-ctx-group')).toBe(2);
    expect(count('.sk-ctx-row')).toBe(8);
  });

  it('comments draw threads with an avatar each over the composer', () => {
    render('comments');
    expect(count('.sk-comments > li')).toBe(3);
    expect(count('.sk-comment .sk-avatar')).toBe(3);
    expect(count('.sk-composer')).toBe(1);
  });

  it('a tab without a layout of its own gets the generic list', () => {
    expect(render('plugin')?.dataset.panel).toBe('fallback');
  });

  it('announces what is loading to assistive tech and hides the shapes', () => {
    render('network');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading requests');
    expect(host.querySelector('.skel-body')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('stays unshown before the delay and shows after it', () => {
    const frame = render('console');
    flush(() => vi.advanceTimersByTime(SKELETON_DELAY_MS - 1));
    expect(frame?.hasAttribute('data-shown')).toBe(false);
    flush(() => vi.advanceTimersByTime(1));
    expect(frame?.hasAttribute('data-shown')).toBe(true);
  });

  it('never shows when the panel is replaced before the delay', () => {
    const frame = render('console');
    flush(() => vi.advanceTimersByTime(SKELETON_DELAY_MS - 10));
    flush(() => root.render(<p>loaded</p>));
    flush(() => vi.advanceTimersByTime(SKELETON_DELAY_MS));
    expect(frame?.hasAttribute('data-shown')).toBe(false);
  });
});

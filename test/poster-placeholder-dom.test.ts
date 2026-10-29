// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Poster, resetPosters } from '../src/client/index/Poster.tsx';
import { RunMosaic } from '../src/client/index/PosterPlaceholder.tsx';
import { rgbaToThumbHash, thumbHashToBase64 } from '../src/shared/thumbhash-encode.ts';
import type { ReviewSuiteIndexRun } from '../src/shared/review-suite.ts';
import type { ReplaySummary } from '../src/shared/replay.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const hash = thumbHashToBase64(rgbaToThumbHash(8, 5, new Uint8Array(8 * 5 * 4).fill(180)));

function summary(id: string, extra: Partial<ReplaySummary> = {}): ReplaySummary {
  return {
    id,
    title: id,
    url: 'https://shop.example/checkout',
    host: 'shop.example',
    capturedAt: '2026-10-26T10:00:00.000Z',
    duration: 4000,
    steps: 3,
    consoleErrors: 0,
    failedRequests: 0,
    source: 'agent',
    ...extra,
  };
}

function run(id: string, status: ReviewSuiteIndexRun['status'], replay?: ReplaySummary): ReviewSuiteIndexRun {
  return {
    id,
    sequence: 1,
    label: `Run ${id}`,
    status,
    startedAt: '2026-10-26T10:00:00.000Z',
    ...(replay ? { replayId: replay.id, replay } : {}),
  };
}

describe('poster placeholder', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    resetPosters();
  });

  function render(element: ReturnType<typeof createElement>) {
    act(() => {
      root.render(element);
    });
  }

  it('shows the recorded host on a calm page, never a letter, and fetches nothing from it', () => {
    render(createElement(Poster, { id: 'demo', host: 'www.shop.example', size: 'card' }));
    expect(host.querySelector('.poster-site-host')?.textContent).toBe('shop.example');
    expect(host.querySelector('.poster-placeholder img')).toBeNull();
    expect(host.querySelector('svg.poster-site-icon')).not.toBeNull();
  });

  it('leaves the host out when there is none', () => {
    render(createElement(Poster, { id: 'demo', host: '', size: 'card' }));
    expect(host.querySelector('.poster-site-host')).toBeNull();
    expect(host.querySelector('svg.poster-site-icon')).not.toBeNull();
  });

  it('shows a suite as a mosaic of its runs, each its ThumbHash or its site', () => {
    const runs = [
      run('a', 'passed', summary('a', { thumbhash: hash })),
      run('b', 'failed', summary('b')),
      run('c', 'passed'),
      run('d', 'passed', summary('d')),
      run('e', 'passed', summary('e')),
    ];
    render(createElement(Poster, { id: undefined, host: '', size: 'card', fallback: createElement(RunMosaic, { runs }) }));
    const cells = [...host.querySelectorAll<HTMLElement>('.poster-run')];
    expect(cells).toHaveLength(4);
    expect(cells[0]?.querySelector('[data-thumbhash]')).not.toBeNull();
    expect(cells[1]?.dataset.status).toBe('failed');
    expect(cells[1]?.querySelector('.poster-site-host')?.textContent).toBe('shop.example');
    expect(cells[2]?.hasAttribute('data-recorded')).toBe(false);
    expect(cells.map((cell) => cell.querySelector('.poster-run-label')?.textContent)).toEqual(['Run a', 'Run b', 'Run c', 'Run d']);
  });
});

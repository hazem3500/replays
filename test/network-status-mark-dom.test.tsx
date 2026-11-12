// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StatusText } from '@/viewer/network/NetworkList.tsx';
import { LabelSearch } from '@/viewer/network/label-search.ts';
import type { NetworkRow } from '@/viewer/network/model.ts';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

const row: NetworkRow = {
  id: 'r',
  entry: {
    id: 'r',
    at: 0,
    duration: 10,
    method: 'GET',
    url: 'https://x.test/missing',
    status: 404,
    statusText: 'Not Found',
    requestHeaders: [],
    responseHeaders: [],
  },
  at: 0,
  end: 10,
  measured: 10,
  type: 'fetch',
  failed: true,
  pending: false,
  slow: false,
  name: { host: 'x.test', path: '/missing', query: '' },
};

let host: HTMLDivElement;
let root: Root;

function render(words: string[]) {
  act(() => {
    root.render(
      <LabelSearch value={words}>
        <StatusText row={row} />
      </LabelSearch>,
    );
  });
  return [...host.querySelectorAll('mark')].map((mark) => mark.textContent);
}

describe('network status cell', () => {
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
  });

  it('shows and marks the status text only while a search word matches it', () => {
    expect(render(['not found'])).toEqual(['Not Found']);
    expect(render(['404'])).toEqual(['404']);
    expect(host.textContent).toBe('404');
  });
});

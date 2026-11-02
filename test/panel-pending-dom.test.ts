// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PanelPending } from '../src/client/viewer/PanelPending.tsx';

describe('pending inspector panels', () => {
  let host: HTMLDivElement;
  let root: Root | undefined;

  const render = (panel: string) => act(() => root?.render(createElement(PanelPending, { panel })));
  const texts = (selector: string) => [...host.querySelectorAll(selector)].map((element) => element.textContent ?? '');

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    host.remove();
  });

  it('draws the network panel’s real toolbar and headers at once, with four stand-in rows and no visible sentence', () => {
    render('network');
    expect(host.querySelector('.panel-pending-search')?.textContent).toBe('Filter URL, method, status');
    expect(texts('.panel-pending-chip')).toEqual(['All', 'Failed', '4xx', '5xx']);
    expect(texts('.panel-pending-head > span')).toEqual(['', 'Method', 'Name', 'Status', 'Type', 'Duration']);
    expect(host.querySelectorAll('.panel-pending-rows .panel-pending-row')).toHaveLength(4);
    expect(host.querySelector('[role="status"]')?.className).toBe('visually-hidden');
  });

  it('draws performance’s vitals strip and its table headers', () => {
    render('performance');
    expect(host.querySelectorAll('.panel-pending-vital')).toHaveLength(4);
    expect(texts('.panel-pending-head > span')).toEqual(['', 'Event', 'When', 'Value', 'Budget']);
  });

  it('still draws stand-in rows for a panel it has no layout for, such as a plugin tab', () => {
    render('plugin:acme:traces');
    expect(host.querySelector('.panel-pending-head')).toBeNull();
    expect(host.querySelectorAll('.panel-pending-rows .panel-pending-row')).toHaveLength(4);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading panel…');
  });
});

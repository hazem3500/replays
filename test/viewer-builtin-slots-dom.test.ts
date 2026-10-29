// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { viewerRegistry } from '../src/client/plugins/registry.ts';
import type { SlotDescriptor } from '../src/client/plugins/slots.ts';
import { contextSections } from '../src/client/viewer/context-sections.tsx';
import { ActionsBar } from '../src/client/viewer/TopbarActions.tsx';

let root: Root;
let host: HTMLDivElement;

function setUp() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  viewerRegistry.reset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
}

function tearDown() {
  act(() => {
    root.unmount();
  });
  host.remove();
  viewerRegistry.reset();
  vi.unstubAllGlobals();
}

function render(node: ReactNode) {
  act(() => {
    root.render(node);
  });
}

const items = (selector: string) =>
  [...host.querySelectorAll<HTMLElement>(`${selector} [data-slot-item]`)].map((item) => item.dataset.slotItem);
const text = (label: string) => createElement('span', null, label);

const SECTIONS: readonly SlotDescriptor<undefined, ReactNode>[] = [
  { id: 'core:summary', order: 100, render: () => text('Summary') },
  { id: 'core:fields', order: 300, render: () => text('Fields') },
];

function Sections({ plugins }: { plugins?: ReactNode }) {
  return createElement('div', { 'data-slot': 'viewer.context.sections' }, contextSections(SECTIONS, undefined, plugins));
}

describe('viewer.actions', () => {
  beforeEach(setUp);
  afterEach(tearDown);

  it('renders the top bar built-ins in their default order', () => {
    render(createElement(ActionsBar, { actions: { 'core:link': text('Link'), 'core:edit': text('Edit'), 'core:info': text('Info') } }));
    expect(items('[data-slot="viewer.actions"]')).toEqual(['core:edit', 'core:info', 'core:link']);
  });

  it('follows a host that hides and reorders built-in actions', () => {
    viewerRegistry.configureSlot('viewer.actions', { order: ['core:link'], hide: ['core:info'] });
    render(createElement(ActionsBar, { actions: { 'core:edit': text('Edit'), 'core:info': text('Info'), 'core:link': text('Link') } }));
    expect(items('[data-slot="viewer.actions"]')).toEqual(['core:link', 'core:edit']);
  });

  it('keeps plugin bar actions after the built-ins', () => {
    render(createElement(ActionsBar, { actions: { 'core:edit': text('Edit') }, plugins: text('Plugin action') }));
    expect(host.textContent).toBe('EditPlugin action');
  });
});

describe('viewer.context.sections', () => {
  beforeEach(setUp);
  afterEach(tearDown);

  it('places a registered plugin section where the host orders it among the built-ins', () => {
    viewerRegistry.apiFor('acme').registerContextSection({ id: 'deploy', title: 'Deploy', render: () => {} });
    viewerRegistry.configureSlot('viewer.context.sections', { order: ['core:summary', 'plugin:acme:deploy'] });
    render(
      createElement(Sections, {
        plugins: [createElement('section', { key: 'plugin:acme:deploy' }, 'Deploy')],
      }),
    );
    expect(host.textContent).toBe('SummaryDeployFields');
  });

  it('drops a built-in section the host hides', () => {
    viewerRegistry.configureSlot('viewer.context.sections', { hide: ['core:fields'] });
    render(createElement(Sections));
    expect(items('[data-slot="viewer.context.sections"]')).toEqual(['core:summary']);
  });

  it('still shows plugin sections the registry does not know, after the built-ins', () => {
    render(createElement(Sections, { plugins: createElement('section', { key: 'plugin:late:one' }, 'Late') }));
    expect(host.textContent).toBe('SummaryFieldsLate');
  });
});

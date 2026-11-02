// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReplayContext } from '../src/shared/context.ts';
import { viewerRegistry } from '../src/client/plugins/registry.ts';
import { ContextPanel } from '../src/client/viewer/ContextPanel.tsx';

const CONTEXT: ReplayContext = {
  version: 1,
  capturedAt: '2026-10-10T12:00:00.000Z',
  app: { version: '1.0', commit: 'abc1234' },
  sources: [{ provider: 'github', url: 'https://github.com/acme/shop/pull/7', label: 'Pull request #7' }],
};

const bundle = { meta: { id: 'demo', title: 'Demo' }, context: CONTEXT } as Parameters<typeof ContextPanel>[0]['bundle'];
const render = (sections?: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(ContextPanel, { bundle, ...(sections ? { sections } : {}) }));

afterEach(() => viewerRegistry.configureSlot('viewer.context.sections', {}));

describe('Context tab sections as viewer.context.sections', () => {
  it('marks each built-in block with its core slot id, in their default order', () => {
    const html = render();
    expect(html).toContain('data-slot="viewer.context.sections"');
    const ids = [...html.matchAll(/data-slot-item="(core:[a-z]+)"/g)].map((match) => match[1]);
    expect(ids).toEqual(['core:summary', 'core:sources', 'core:fields']);
  });

  it('drops a built-in block the slot configuration hides', () => {
    viewerRegistry.configureSlot('viewer.context.sections', { hide: ['core:sources'] });
    const html = render();
    expect(html).not.toContain('Pull request #7');
    expect(html).toContain('data-slot-item="core:fields"');
  });

  it('puts the configured ids first', () => {
    viewerRegistry.configureSlot('viewer.context.sections', { order: ['core:fields'] });
    const ids = [...render().matchAll(/data-slot-item="(core:[a-z]+)"/g)].map((match) => match[1]);
    expect(ids[0]).toBe('core:fields');
  });

  it('keeps plugin sections the registry does not know after the built-ins', () => {
    const html = render(createElement('section', { key: 'plugin:acme:notes' }, 'Plugin notes'));
    expect(html.indexOf('Plugin notes')).toBeGreaterThan(html.indexOf('data-slot-item="core:fields"'));
  });
});

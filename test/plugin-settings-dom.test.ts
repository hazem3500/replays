// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DropdownMenu, DropdownMenuContent } from '../src/client/components/ui/dropdown-menu.tsx';
import { usePluginMenu } from '../src/client/plugins/PluginUi.tsx';
import { viewerRegistry } from '../src/client/plugins/registry.ts';
import { readSetting, writeSetting } from '../src/client/plugins/settings.ts';

let root: Root;
let host: HTMLDivElement;
const boolean = { id: 'visible', label: 'Show details', type: 'boolean', default: false } as const;
const choice = {
  id: 'units',
  label: 'Units',
  type: 'choice',
  default: 'seconds',
  options: [{ value: 'seconds' }, { value: 'ms' }],
} as const;

function Menu() {
  const { settings } = usePluginMenu(() => {
    throw new Error('No action context needed');
  });
  return createElement(DropdownMenu, { open: true }, createElement(DropdownMenuContent, null, settings));
}

function setting(id: string) {
  const element = document.querySelector<HTMLElement>(`[data-testid="plugin-setting:test:${id}"]`);
  expect(element).not.toBeNull();
  return element!;
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  viewerRegistry.reset();
  viewerRegistry.apiFor('test').registerSetting(boolean);
  viewerRegistry.apiFor('test').registerSetting(choice);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Menu)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  viewerRegistry.reset();
  vi.unstubAllGlobals();
});

it('reacts to checkbox and choice updates without replacing registry definitions or closing the menu', async () => {
  const registry = viewerRegistry.getSnapshot();
  await act(async () => setting('visible').click());
  expect(setting('visible').getAttribute('aria-checked')).toBe('true');
  expect(readSetting('test', boolean)).toBe(true);
  await act(async () => setting('units:ms').click());
  expect(setting('units:ms').getAttribute('aria-checked')).toBe('true');
  expect(setting('units:seconds').getAttribute('aria-checked')).toBe('false');
  expect(viewerRegistry.getSnapshot()).toBe(registry);
});

it('reflects changes from plugin settings listeners rather than only local control events', async () => {
  await act(async () => {
    writeSetting('test', boolean, true);
    writeSetting('test', choice, 'ms');
  });
  expect(setting('visible').getAttribute('aria-checked')).toBe('true');
  expect(setting('units:ms').getAttribute('aria-checked')).toBe('true');
});

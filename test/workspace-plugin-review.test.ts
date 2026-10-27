// @vitest-environment jsdom
import { isRecord } from '../src/shared/plugin-validation.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspacePluginNotices } from '../src/client/malleable/WorkspacePluginNotices.tsx';
import { getMalleableUi } from '../src/client/malleable/ui-state.ts';
import { manager } from '../src/client/malleable/manager.ts';
import { viewerRegistry } from '../src/client/plugins/registry.ts';
import { starterPlugin, USER_PLUGIN_HISTORY_FORMAT } from '../src/shared/malleable.ts';

describe('workspace plugin review before execution', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    viewerRegistry.reset();
  });
  it('keeps saved contributions unloaded through reloads and enables only after the accepted digest is recorded', async () => {
    const { manifest, source } = starterPlugin('workspace-review-client');
    const sha256 = '1'.repeat(64);
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        requests.push(url);
        let body: unknown = { accepted: true };
        if (url.endsWith('/plugins'))
          body = { plugins: [{ id: manifest.id, scope: 'workspace', name: manifest.name, requiresReview: true, sha256 }] };
        else if (url.includes('/plugins/workspace/'))
          body = {
            format: USER_PLUGIN_HISTORY_FORMAT,
            id: manifest.id,
            versions: [{ n: 1, manifest, source, sha256, by: 'Ada', at: '2026-01-01', message: '' }],
          };
        if (url.includes('/notices/')) {
          if (typeof init?.body !== 'string') throw new Error('expected notice body');
          const payload: unknown = JSON.parse(init.body);
          if (!isRecord(payload) || payload.sha256 !== sha256) throw new Error('wrong digest');
        }
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }),
    );
    await manager.loadSaved();
    expect(viewerRegistry.getSnapshot().tabs.some((tab) => tab.plugin === `user:${manifest.id}`)).toBe(false);
    manager.reload(manifest.id);
    expect(manager.get(manifest.id)?.needsAcceptance).toBe(true);
    expect(viewerRegistry.getSnapshot().tabs.some((tab) => tab.plugin === `user:${manifest.id}`)).toBe(false);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await settle(() => root.render(createElement(WorkspacePluginNotices)));

    await settle(buttonClick(container, 'Review source'));
    expect(getMalleableUi().workshopPlugin).toBe(manifest.id);
    expect(container.textContent).toContain('New workspace plugin from Ada');
    await settle(buttonClick(container, 'Enable this version'));
    await vi.waitFor(() => expect(manager.get(manifest.id)?.needsAcceptance).toBe(false));
    act(() => root.unmount());
    container.remove();
    expect(requests.some((url) => url.endsWith(`/notices/${manifest.id}`))).toBe(true);
    expect(viewerRegistry.getSnapshot().tabs.some((tab) => tab.plugin === `user:${manifest.id}`)).toBe(true);
    manager.setEnabled(manifest.id, false);
    expect(viewerRegistry.getSnapshot().tabs.some((tab) => tab.plugin === `user:${manifest.id}`)).toBe(false);
  });
});

function buttonClick(container: HTMLElement, label: string): () => void {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label);
  if (!button) throw new Error(`missing button: ${label}`);
  return () => button.click();
}

async function settle(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}

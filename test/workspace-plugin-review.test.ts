// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspacePluginNotices } from '../src/client/malleable/WorkspacePluginNotices.tsx';
import { getMalleableUi } from '../src/client/malleable/ui-state.ts';
import { manager } from '../src/client/malleable/manager.ts';
import { viewerRegistry } from '../src/client/plugins/registry.ts';
import { starterPlugin, USER_PLUGIN_HISTORY_FORMAT } from '../src/shared/malleable.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  viewerRegistry.reset();
});

describe('workspace plugin review before execution', () => {
  it('keeps saved contributions unloaded through reloads and enables only after the accepted digest is recorded', async () => {
    const { manifest, source } = starterPlugin('workspace-review-client');
    const sha256 = '1'.repeat(64);
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push(url);
        const body = url.endsWith('/plugins')
          ? { plugins: [{ id: manifest.id, scope: 'workspace', name: manifest.name, requiresReview: true, sha256 }] }
          : url.includes('/plugins/workspace/')
            ? {
                format: USER_PLUGIN_HISTORY_FORMAT,
                id: manifest.id,
                versions: [{ n: 1, manifest, source, sha256, by: 'Ada', at: '2026-01-01', message: '' }],
              }
            : { accepted: true };
        if (url.includes('/notices/')) {
          const payload = JSON.parse(init!.body as string) as { sha256: string };
          if (payload.sha256 !== sha256) throw new Error('wrong digest');
        }
        return new Response(JSON.stringify(body), { status: 200 });
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
    await act(async () => root.render(createElement(WorkspacePluginNotices)));
    const buttons = [...container.querySelectorAll('button')];
    await act(async () => buttons.find((button) => button.textContent === 'Review source')!.click());
    expect(getMalleableUi().workshopPlugin).toBe(manifest.id);
    expect(container.textContent).toContain('New workspace plugin from Ada');
    await act(async () => buttons.find((button) => button.textContent === 'Enable this version')!.click());
    await act(async () => root.unmount());
    container.remove();
    expect(requests.some((url) => url.endsWith(`/notices/${manifest.id}`))).toBe(true);
    expect(viewerRegistry.getSnapshot().tabs.some((tab) => tab.plugin === `user:${manifest.id}`)).toBe(true);
    manager.setEnabled(manifest.id, false);
    expect(viewerRegistry.getSnapshot().tabs.some((tab) => tab.plugin === `user:${manifest.id}`)).toBe(false);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindUserSettings, readSetting, subscribeSettings, writeSettingValue } from '../src/client/plugins/settings.ts';
import type { SettingDefinition } from '../src/client/plugins/api.ts';

afterEach(() => vi.unstubAllGlobals());
const setting: SettingDefinition = { id: 'compact', label: 'Compact', type: 'boolean', default: false };

describe('Settings server preference adapter', () => {
  it('hydrates the contribution, serializes writes and publishes values without local storage', async () => {
    const requests: string[] = [];
    let version = 0;
    const baseVersions: number[] = [];
    let value = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push(url);
        if (init?.method === 'PUT') {
          const body = JSON.parse(init.body as string) as { value: boolean; baseVersion: number };
          baseVersions.push(body.baseVersion);
          value = body.value;
          version++;
        }
        return new Response(JSON.stringify({ version, values: { compact: value } }), { status: 200 });
      }),
    );
    const listener = vi.fn<() => void>();
    const unsubscribe = subscribeSettings(listener);
    bindUserSettings('user:settings-adapter', 'user', 'settings-adapter');
    await vi.waitFor(() => expect(readSetting('user:settings-adapter', setting)).toBe(true));
    await Promise.all([
      writeSettingValue('user:settings-adapter', setting, false),
      writeSettingValue('user:settings-adapter', setting, true),
    ]);
    expect(version).toBe(2);
    expect(baseVersions).toEqual([0, 1]);
    expect(listener).toHaveBeenCalledWith('user:settings-adapter', 'compact', true);
    expect(requests.every((url) => url.endsWith('/malleable/settings/user/settings-adapter'))).toBe(true);
    expect(localStorage.getItem('replays-plugin:user:settings-adapter:setting:compact')).toBeNull();
    unsubscribe();
  });
});

// @vitest-environment jsdom
import { isRecord } from '../src/shared/plugin-validation.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindUserSettings, readSetting, subscribeSettings, writeSettingValue } from '../src/client/plugins/settings.ts';
import type { SettingDefinition } from '../src/client/plugins/api.ts';

const setting: SettingDefinition = { id: 'compact', label: 'Compact', type: 'boolean', default: false };

describe('Settings server preference adapter', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('hydrates the contribution, serializes writes and publishes values without local storage', async () => {
    const requests: string[] = [];
    let version = 0;
    const baseVersions: number[] = [];
    let value = true;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        requests.push(url);
        if (init?.method === 'PUT') {
          if (typeof init.body !== 'string') throw new Error('expected JSON request');
          const body: unknown = JSON.parse(init.body);
          if (!isRecord(body) || typeof body.value !== 'boolean' || typeof body.baseVersion !== 'number')
            throw new Error('invalid settings write');
          baseVersions.push(body.baseVersion);
          value = body.value;
          version++;
        }
        return Promise.resolve(new Response(JSON.stringify({ version, values: { compact: value } }), { status: 200 }));
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

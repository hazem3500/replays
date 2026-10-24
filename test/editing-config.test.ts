import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { withBase } from '../src/server/base-path.ts';
import { loadSettings, readConfigFile, type FileConfig } from '../src/server/config.ts';
import { editingFromEnv } from '../src/server/editing-config.ts';

// This is a deployment write policy; it must never enable a beta feature or malleable capability.
describe('host editing config', () => {
  it('defaults writes on without enabling beta, and allows the environment to override the file', async () => {
    expect(editingFromEnv({})).toEqual({ enabled: true });
    const dir = await mkdtemp(join(tmpdir(), 'replays-editing-'));
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ beta: { editor: true }, editing: { enabled: false } }));
    const file = await readConfigFile(path);
    expect((await loadSettings({}, file)).editing).toEqual({ enabled: false });
    expect((await loadSettings({ EDITING_ENABLED: 'true' }, file)).editing).toEqual({ enabled: true });
    for (const enabled of ['true', '1', 'YES', 'on']) expect(editingFromEnv({ EDITING_ENABLED: enabled })).toEqual({ enabled: true });
    for (const disabled of ['false', '0', 'NO', 'off']) expect(editingFromEnv({ EDITING_ENABLED: disabled })).toEqual({ enabled: false });
    expect(editingFromEnv({ EDITING_ENABLED: '  ' }, { enabled: false })).toEqual({ enabled: false });
    const settings = await loadSettings({ EDITING_ENABLED: 'true' });
    expect(settings.beta).toEqual({ editor: false, malleable: false });
  });

  it('fails startup on invalid shapes and non-booleans even when an environment value overrides the file', async () => {
    for (const editing of [false, null, [], 'false'])
      await expect(loadSettings({}, { editing } as unknown as FileConfig)).rejects.toThrow('editing must be an object');
    for (const enabled of ['false', 0, null])
      await expect(loadSettings({ EDITING_ENABLED: 'true' }, { editing: { enabled } } as unknown as FileConfig)).rejects.toThrow(
        'editing.enabled must be true or false',
      );
    expect(() => editingFromEnv({}, { enable: false } as never)).toThrow('editing has unknown keys');
    await expect(loadSettings({ EDITING_ENABLED: 'sometimes' })).rejects.toThrow('EDITING_ENABLED must be true or false');
  });

  it('writes the effective policy into the served page independently of the beta metadata', () => {
    const html = '<meta name="app-editing" content="" /><meta name="app-beta" content="" />';
    const branding = { name: 'x', tokensCss: '', beta: 'editor' };
    expect(withBase(html, '', { ...branding, editing: false })).toBe(
      '<meta name="app-editing" content="off" /><meta name="app-beta" content="editor" />',
    );
    expect(withBase(html, '', { ...branding, editing: true })).toContain('app-editing" content="on"');
  });
});

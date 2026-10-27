import { describe, expect, it } from 'vitest';

import { withBase } from '../src/server/base-path.ts';
import { betaFromEnv } from '../src/server/beta.ts';
import { loadSettings, readConfigFile } from '../src/server/config.ts';
import { renderIndexHtml } from '../src/server/index-page.ts';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('beta flags', () => {
  it('are all off by default', () => {
    expect(betaFromEnv({})).toEqual({ editor: false, malleable: false, groupedInspector: false });
  });

  it('read REPLAYS_BETA_EDITOR, which beats the config file', () => {
    for (const on of ['true', '1', 'YES', 'on'])
      expect(betaFromEnv({ REPLAYS_BETA_EDITOR: on })).toEqual({ editor: true, malleable: false, groupedInspector: false });
    for (const off of ['false', '0', 'no', 'off', ''])
      expect(betaFromEnv({ REPLAYS_BETA_EDITOR: off }, { editor: true })).toEqual({
        editor: false,
        malleable: false,
        groupedInspector: false,
      });
    expect(betaFromEnv({}, { editor: true })).toEqual({ editor: true, malleable: false, groupedInspector: false });
  });

  it('refuse values that are not booleans', () => {
    expect(() => betaFromEnv({ REPLAYS_BETA_EDITOR: 'maybe' })).toThrow(/REPLAYS_BETA_EDITOR must be true or false/);
    expect(() => betaFromEnv({}, { editor: 'yes' })).toThrow(/beta\.editor must be true or false/);
    expect(() => betaFromEnv({ REPLAYS_BETA_GROUPED_INSPECTOR: 'maybe' })).toThrow(/REPLAYS_BETA_GROUPED_INSPECTOR must be true or false/);
    expect(() => betaFromEnv({}, { groupedInspector: 'yes' })).toThrow(/beta\.groupedInspector must be true or false/);
  });

  it('reads and validates the grouped Inspector flag', () => {
    for (const on of ['true', '1', 'YES', 'on']) expect(betaFromEnv({ REPLAYS_BETA_GROUPED_INSPECTOR: on }).groupedInspector).toBe(true);
    expect(betaFromEnv({ REPLAYS_BETA_GROUPED_INSPECTOR: 'false' }, { groupedInspector: true }).groupedInspector).toBe(false);
    expect(betaFromEnv({}, { groupedInspector: true }).groupedInspector).toBe(true);
  });

  it('load from the config file and the environment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'replays-beta-'));
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ beta: { editor: true, groupedInspector: true } }));
    expect((await loadSettings({}, await readConfigFile(path))).beta).toEqual({ editor: true, malleable: false, groupedInspector: true });
    expect((await loadSettings({ REPLAYS_BETA_EDITOR: 'false' }, await readConfigFile(path))).beta).toEqual({
      editor: false,
      malleable: false,
      groupedInspector: true,
    });
    expect((await loadSettings({})).beta).toEqual({ editor: false, malleable: false, groupedInspector: false });
  });

  it('are written into index.html for the client, empty when off', () => {
    const html = '<head><meta name="app-base" content="" /><meta name="app-beta" content="" /></head>';
    const branding = { name: 'x', tokensCss: '' };
    expect(withBase(html, '', branding)).toContain('<meta name="app-beta" content="" />');
    expect(withBase(html, '', { ...branding, beta: 'editor grouped-inspector' })).toContain(
      '<meta name="app-beta" content="editor grouped-inspector" />',
    );
    expect(
      renderIndexHtml(html, {
        base: '',
        branding: { name: 'x' },
        beta: { editor: false, malleable: false, groupedInspector: true },
      }),
    ).toContain('<meta name="app-beta" content="grouped-inspector" />');
  });
});

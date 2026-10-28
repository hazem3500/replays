import { describe, expect, it } from 'vitest';

import { withBase } from '../src/server/base-path.ts';
import { betaFromEnv } from '../src/server/beta.ts';
import { BETA_FLAG_IDS, BETA_FLAGS, betaFromTokens, betaTokens } from '../src/shared/beta-flags.ts';
import { loadSettings, readConfigFile } from '../src/server/config.ts';
import { renderIndexHtml } from '../src/server/index-page.ts';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('beta flags', () => {
  it('are all off by default', () => {
    expect(betaFromEnv({})).toEqual({ editor: false, malleable: false });
  });

  it('read REPLAYS_BETA_EDITOR, which beats the config file', () => {
    for (const on of ['true', '1', 'YES', 'on'])
      expect(betaFromEnv({ REPLAYS_BETA_EDITOR: on })).toEqual({ editor: true, malleable: false });
    for (const off of ['false', '0', 'no', 'off', ''])
      expect(betaFromEnv({ REPLAYS_BETA_EDITOR: off }, { editor: true })).toEqual({ editor: false, malleable: false });
    expect(betaFromEnv({}, { editor: true })).toEqual({ editor: true, malleable: false });
  });

  it('refuse values that are not booleans', () => {
    expect(() => betaFromEnv({ REPLAYS_BETA_EDITOR: 'maybe' })).toThrow(/REPLAYS_BETA_EDITOR must be true or false/);
    expect(() => betaFromEnv({}, { editor: 'yes' })).toThrow(/beta\.editor must be true or false/);
  });

  it('load from the config file and the environment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'replays-beta-'));
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ beta: { editor: true } }));
    expect((await loadSettings({}, await readConfigFile(path))).beta).toEqual({ editor: true, malleable: false });
    expect((await loadSettings({ REPLAYS_BETA_EDITOR: 'false' }, await readConfigFile(path))).beta).toEqual({ editor: false, malleable: false });
    expect((await loadSettings({})).beta).toEqual({ editor: false, malleable: false });
  });

  it('are written into index.html for the client, empty when off', () => {
    const html = '<head><meta name="app-base" content="" /><meta name="app-beta" content="" /></head>';
    const branding = { name: 'x', tokensCss: '' };
    expect(withBase(html, '', branding)).toContain('<meta name="app-beta" content="" />');
    expect(withBase(html, '', { ...branding, beta: 'editor malleable' })).toContain('<meta name="app-beta" content="editor malleable" />');
    expect(
      renderIndexHtml(html, {
        base: '',
        branding: { name: 'x' },
        beta: { editor: true, malleable: false },
      }),
    ).toContain('<meta name="app-beta" content="editor" />');
  });

  it('parse every flag in the shared registry, and the page reads back exactly what the server allowed', () => {
    for (const flag of BETA_FLAGS) {
      const fromEnv = betaFromEnv({ [flag.env]: 'true' });
      expect(
        Object.entries(fromEnv)
          .filter(([, on]) => on)
          .map(([id]) => id),
      ).toEqual([flag.id]);
      expect(betaFromEnv({}, { [flag.configKey]: true })[flag.id]).toBe(true);
      expect(() => betaFromEnv({}, { [flag.configKey]: 'yes' })).toThrow(new RegExp(`beta\\.${flag.configKey} must be true or false`));
      const html = renderIndexHtml('<meta name="app-beta" content="" />', { base: '', branding: { name: 'x' }, beta: fromEnv });
      const content = /content="([^"]*)"/.exec(html)?.[1];
      expect(content).toBe(betaTokens(fromEnv));
      const readBack = betaFromTokens(content);
      for (const id of BETA_FLAG_IDS) expect(readBack[id]).toBe(fromEnv[id]);
    }
  });
});

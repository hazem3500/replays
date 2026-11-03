import { describe, expect, it } from 'vitest';

import {
  BETA_FLAGS,
  BETA_FLAG_IDS,
  betaEffective,
  betaFromTokens,
  betaTokens,
  labsFlags,
  NO_BETA,
  resolveBetaFlags,
} from '../src/shared/beta-flags.ts';

describe('beta flag registry', () => {
  it('lists each flag once with its server switches and one-line copy', () => {
    expect(BETA_FLAG_IDS).toEqual(['editor', 'cursorCustomization', 'malleable']);
    expect(BETA_FLAGS.map((flag) => flag.env)).toEqual([
      'REPLAYS_BETA_EDITOR',
      'REPLAYS_BETA_CURSOR_CUSTOMIZATION',
      'REPLAYS_BETA_MALLEABLE',
    ]);
    expect(BETA_FLAGS.map((flag) => flag.token)).toEqual(['editor', 'cursor-customization', 'malleable']);
    for (const flag of BETA_FLAGS) {
      expect(flag.configKey).toBe(flag.id);
      expect(flag.label.length).toBeGreaterThan(0);
      expect(flag.description).not.toContain('\n');
      expect(flag.description.length).toBeLessThanOrEqual(90);
    }
    expect(new Set(BETA_FLAGS.map((flag) => flag.token)).size).toBe(BETA_FLAGS.length);
    expect(NO_BETA).toEqual({ editor: false, cursorCustomization: false, malleable: false });
  });

  it('round-trips the allowed set through the index.html meta tokens', () => {
    expect(betaTokens(NO_BETA)).toBe('');
    expect(betaTokens({ editor: true, cursorCustomization: false, malleable: true })).toBe('editor malleable');
    expect(betaTokens({ malleable: true })).toBe('malleable');
    expect(betaFromTokens('editor retired-flag')).toEqual({ editor: true, cursorCustomization: false, malleable: false });
    expect(betaFromTokens('malleable,editor unknown')).toEqual({ editor: true, cursorCustomization: false, malleable: true });
    expect(betaFromTokens(null)).toEqual(NO_BETA);
  });

  it('treats the server as the ceiling and the person’s choice as an opt-out (on by default)', () => {
    expect(betaEffective('editor', false, true)).toBe(false);
    expect(betaEffective('editor', true)).toBe(true);
    expect(betaEffective('editor', true, false)).toBe(false);
    expect(betaEffective('malleable', true, true)).toBe(true);
    expect(resolveBetaFlags({ editor: true, cursorCustomization: false, malleable: true }, { malleable: false })).toEqual({
      editor: true,
      cursorCustomization: false,
      malleable: false,
    });
  });

  it('requires both deployment permission and browser opt-in for cursor customization', () => {
    expect(betaEffective('cursorCustomization', false, true)).toBe(false);
    expect(betaEffective('cursorCustomization', true)).toBe(false);
    expect(betaEffective('cursorCustomization', true, true)).toBe(true);
    expect(betaFromTokens('editor cursor-customization').cursorCustomization).toBe(true);
  });

  it('offers in Labs only the flags this server allows', () => {
    expect(labsFlags(NO_BETA)).toEqual([]);
    expect(labsFlags({ editor: true }).map((flag) => flag.id)).toEqual(['editor']);
  });
});

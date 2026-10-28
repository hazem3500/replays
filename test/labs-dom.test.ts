// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';

import { betaMalleable } from '../src/client/malleable/flag.ts';
import {
  betaAllowed,
  betaChoice,
  betaEnabled,
  browserLabsChoices,
  type LabsChoiceStore,
  setBetaAllowedForTests,
  setBetaChoice,
  setLabsChoiceStore,
} from '../src/client/settings/labs.ts';

function allow(content: string) {
  const meta = document.createElement('meta');
  meta.name = 'app-beta';
  meta.content = content;
  document.head.append(meta);
}

describe('Labs choices', () => {
  afterEach(() => {
    setBetaAllowedForTests(undefined);
    setLabsChoiceStore(browserLabsChoices);
    localStorage.clear();
    document.querySelector('meta[name="app-beta"]')?.remove();
  });

  it('read what the server allows from index.html', () => {
    expect(betaAllowed('editor')).toBe(false);
    allow('editor grouped-inspector');
    expect(betaAllowed('editor')).toBe(true);
    expect(betaAllowed('malleable')).toBe(false);
  });

  it('turn allowed flags on by default and let a person opt out per browser', () => {
    allow('editor');
    expect(betaEnabled('editor')).toBe(true);
    setBetaChoice('editor', false);
    expect(localStorage.getItem('replays-labs-editor')).toBe('off');
    expect(betaEnabled('editor')).toBe(false);
    setBetaChoice('editor', undefined);
    expect(localStorage.getItem('replays-labs-editor')).toBeNull();
    expect(betaEnabled('editor')).toBe(true);
  });

  it('never turn on a flag the server does not allow', () => {
    setBetaChoice('malleable', true);
    expect(betaChoice('malleable')).toBe(true);
    expect(betaEnabled('malleable')).toBe(false);
  });

  it('accept a different store (per-user preferences later)', () => {
    const saved: Record<string, boolean | undefined> = { editor: false };
    const store: LabsChoiceStore = {
      get: (id) => saved[id],
      set: (id, value) => {
        saved[id] = value;
      },
      subscribe: () => () => {},
    };
    setLabsChoiceStore(store);
    setBetaAllowedForTests({ editor: true });
    expect(betaEnabled('editor')).toBe(false);
    setBetaChoice('editor', true);
    expect(saved.editor).toBe(true);
    expect(localStorage.getItem('replays-labs-editor')).toBeNull();
  });

  it('fix plugin boot to the value the page loaded with', () => {
    setBetaAllowedForTests({ malleable: true });
    expect(betaMalleable()).toBe(true);
    setBetaChoice('malleable', false);
    expect(betaEnabled('malleable')).toBe(false);
    expect(betaMalleable()).toBe(true);
  });
});

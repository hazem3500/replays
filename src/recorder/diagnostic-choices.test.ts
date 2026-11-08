// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { recorderChoices } from './recorder-choices.ts';
import { settingsBuilder } from './recorder-settings.ts';
import type { RecorderOptions } from './types.ts';

describe('independent diagnostic choices', () => {
  afterEach(() => localStorage.clear());

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('keeps diagnostic choices independent with performance %s and debugging %s', (performance, debugging) => {
    const host: Pick<RecorderOptions, 'privacy' | 'capture' | 'choices'> = {
      privacy: { sanitize: false },
      capture: { performance: true, debugging: true },
      choices: { diagnostics: true },
    };
    const choices = recorderChoices(host, settingsBuilder(host));
    const selection = choices.accept({ performance, debugging });
    expect(choices.settings(selection).capture).toMatchObject({ performance, debugging });
  });

  it('does not let staff defaults exceed the host diagnostic cap', () => {
    const host: Pick<RecorderOptions, 'privacy' | 'capture' | 'choices'> = {
      capture: { performance: true, debugging: false },
      choices: { diagnostics: true, defaults: { performance: true, debugging: true } },
    };
    const choices = recorderChoices(host, settingsBuilder(host));
    expect(choices.settings().capture).toMatchObject({ performance: true, debugging: false });
  });

  it('requires an accepted customer choice before enabling diagnostics', () => {
    const host: Pick<RecorderOptions, 'privacy' | 'capture' | 'choices'> = {
      capture: { performance: true, debugging: true },
      choices: { by: 'customer', diagnostics: true, defaults: { performance: true, debugging: true } },
    };
    const choices = recorderChoices(host, settingsBuilder(host));
    expect(choices.settings({ performance: true, debugging: true }).capture).toMatchObject({ performance: false, debugging: false });
    expect(choices.settings(choices.accept({ performance: true, debugging: false })).capture).toMatchObject({
      performance: true,
      debugging: false,
    });
  });
});

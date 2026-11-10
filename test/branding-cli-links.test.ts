import { describe, expect, it } from 'vitest';

import { helpLink } from '../src/client/settings/config-query.ts';
import { validateBranding } from '../src/server/branding.ts';

describe('host CLI and links branding', () => {
  it('accepts cli commands and help links', () => {
    expect(
      validateBranding({
        cli: { install: 'npm i -g @example/cli', connect: 'example login' },
        links: {
          source: false,
          cliGuide: 'https://example.com/cli',
          authGuide: 'https://example.com/auth',
        },
      }),
    ).toEqual({
      name: 'replays',
      cli: { install: 'npm i -g @example/cli', connect: 'example login' },
      links: {
        source: false,
        cliGuide: 'https://example.com/cli',
        authGuide: 'https://example.com/auth',
      },
    });
  });

  it('refuses invalid link or cli values', () => {
    expect(() => validateBranding({ links: { docs: 'http://insecure' } })).toThrow('https URL');
    expect(() => validateBranding({ cli: { install: 'line one\nline two' } })).toThrow('one line');
  });

  it('hides links the host set to false once config is loaded', () => {
    expect(helpLink(undefined, 'source')).toBeUndefined();
    expect(helpLink({ links: { source: false } }, 'source')).toBeUndefined();
    expect(helpLink({ links: {} }, 'source')).toContain('github.com/hazem3500/replays');
    expect(helpLink({ links: { cliGuide: 'https://example.com/cli' } }, 'cliGuide')).toBe('https://example.com/cli');
  });
});

import { describe, expect, it } from 'vitest';

import { githubProvider, gitlabProvider, SourceProviders, templateProvider, urlProvider } from '../src/shared/source-providers.ts';

describe('github provider', () => {
  const github = githubProvider();

  it('resolves issue and pull request references to the issues route (GitHub redirects between them)', () => {
    expect(github.resolve('example-org/shop-demo#42')).toEqual({
      url: 'https://github.com/example-org/shop-demo/issues/42',
      label: 'example-org/shop-demo#42',
    });
    expect(github.resolve('a/b.c_d-e#1')).toMatchObject({ url: 'https://github.com/a/b.c_d-e/issues/1' });
  });

  it('resolves commits and shortens the label to seven characters', () => {
    expect(github.resolve('example-org/shop-demo@a1b2c3d4e5f6789')).toEqual({
      url: 'https://github.com/example-org/shop-demo/commit/a1b2c3d4e5f6789',
      label: 'example-org/shop-demo@a1b2c3d',
    });
    expect(github.resolve('example-org/shop-demo@A1B2C3D')).toBeDefined();
  });

  it('refuses anything that is not owner/repo#number or owner/repo@sha', () => {
    for (const bad of [
      '',
      '42',
      '#42',
      'example-org#42',
      'example-org/shop-demo',
      'example-org/shop-demo#',
      'example-org/shop-demo#abc',
      'example-org/shop-demo#1234567890',
      'example-org/shop-demo/extra#1',
      'example-org/shop-demo@abc',
      'example-org/shop-demo@xyz1234',
      'example-org/shop-demo@' + 'a'.repeat(41),
      'example org/shop-demo#1',
      'https://github.com/example-org/shop-demo/pull/1',
      '../shop-demo#1',
      'example-org/shop-demo#1\nx',
    ])
      expect(github.resolve(bad)).toBeUndefined();
  });

  it('uses a configured host for GitHub Enterprise', () => {
    expect(githubProvider('github.example.com').resolve('example-org/shop-demo#7')?.url).toBe(
      'https://github.example.com/example-org/shop-demo/issues/7',
    );
  });
});

describe('gitlab provider', () => {
  const gitlab = gitlabProvider();

  it('resolves issues and merge requests, including nested groups', () => {
    expect(gitlab.resolve('example-group/shop-demo#5')).toEqual({
      url: 'https://gitlab.com/example-group/shop-demo/-/issues/5',
      label: 'example-group/shop-demo#5',
    });
    expect(gitlab.resolve('example-group/team/shop-demo!9')).toEqual({
      url: 'https://gitlab.com/example-group/team/shop-demo/-/merge_requests/9',
      label: 'example-group/team/shop-demo!9',
    });
  });

  it('refuses malformed references', () => {
    for (const bad of [
      '',
      'shop-demo#5',
      'example-group/shop-demo',
      'example-group/shop-demo#',
      'example-group/shop-demo?5',
      'example-group/shop demo#5',
      'example-group/shop-demo#1234567890',
    ])
      expect(gitlab.resolve(bad)).toBeUndefined();
  });

  it('uses a configured host for self-managed GitLab', () => {
    expect(gitlabProvider('gitlab.example.com').resolve('g/p!1')?.url).toBe('https://gitlab.example.com/g/p/-/merge_requests/1');
  });
});

describe('url provider', () => {
  it('accepts an https link and labels it with the host name', () => {
    expect(urlProvider.resolve('https://tickets.example.com/browse/SHOP-7?x=1')).toEqual({
      url: 'https://tickets.example.com/browse/SHOP-7?x=1',
      label: 'tickets.example.com',
    });
  });

  it('refuses http, other schemes, credentials, fragments and things that are not URLs', () => {
    for (const bad of [
      'http://tickets.example.com/1',
      'javascript:alert(1)',
      'data:text/html,hi',
      'ftp://example.com/x',
      'https://user:pass@example.com/',
      'https://example.com/#frag',
      'tickets.example.com/1',
      '',
      `https://example.com/${'a'.repeat(2100)}`,
    ])
      expect(urlProvider.resolve(bad)).toBeUndefined();
  });
});

describe('template provider', () => {
  const jira = templateProvider({
    id: 'jira',
    label: 'Jira',
    template: 'https://jira.example.com/browse/{ref}',
    pattern: '^[A-Z]+-\\d+$',
  });

  it('puts the URL-encoded reference into the template', () => {
    expect(jira.id).toBe('jira');
    expect(jira.label).toBe('Jira');
    expect(jira.resolve('SHOP-7')).toEqual({ url: 'https://jira.example.com/browse/SHOP-7', label: 'SHOP-7' });
    const plain = templateProvider({ id: 'wiki', template: 'https://wiki.example.com/search?q={ref}' });
    expect(plain.resolve('a&b=c')?.url).toBe('https://wiki.example.com/search?q=a%26b%3Dc');
    expect(plain.label).toBe('wiki');
  });

  it('checks the pattern, and by default accepts one whitespace-free token of up to 200 characters', () => {
    expect(jira.resolve('shop-7')).toBeUndefined();
    expect(jira.resolve('SHOP-7 extra')).toBeUndefined();
    const plain = templateProvider({ id: 'wiki', template: 'https://wiki.example.com/{ref}' });
    expect(plain.resolve('has space')).toBeUndefined();
    expect(plain.resolve('x'.repeat(201))).toBeUndefined();
    expect(plain.resolve('x'.repeat(200))).toBeDefined();
  });

  it('gets the mark its id names, unless it names its own; an unknown mark is refused', () => {
    expect(jira.mark).toBe('jira');
    expect(templateProvider({ id: 'tickets', template: 'https://t.example.com/{ref}' }).mark).toBeUndefined();
    expect(templateProvider({ id: 'tickets', template: 'https://t.example.com/{ref}', mark: 'linear' }).mark).toBe('linear');
    expect(
      () => new SourceProviders({ templates: [{ id: 'x', template: 'https://x.example.com/{ref}', mark: 'myspace' as never }] }),
    ).toThrow(/mark must be one of/);
    expect([githubProvider().mark, gitlabProvider().mark, urlProvider.mark]).toEqual(['github', 'gitlab', 'link']);
  });

  it('fails at configuration time for a bad id, a template without {ref} or an unsafe template', () => {
    expect(() => templateProvider({ id: 'Jira!', template: 'https://jira.example.com/{ref}' })).toThrow(/id "Jira!" is invalid/);
    expect(() => templateProvider({ id: 'jira', template: 'https://jira.example.com/browse/' })).toThrow(/needs \{ref\}/);
    expect(() => templateProvider({ id: 'jira', template: 'http://jira.example.com/{ref}' })).toThrow(/template is unsafe/);
    expect(() => templateProvider({ id: 'jira', template: 'https://user:pw@jira.example.com/{ref}' })).toThrow(/unsafe/);
  });
});

describe('SourceProviders', () => {
  const providers = new SourceProviders({ templates: [{ id: 'jira', label: 'Jira', template: 'https://jira.example.com/browse/{ref}' }] });

  it('lists the built-in providers and any configured ones', () => {
    expect(new SourceProviders().ids).toEqual(['github', 'gitlab', 'url']);
    expect(providers.ids).toEqual(['github', 'gitlab', 'url', 'jira']);
  });

  it('applies the configured hosts', () => {
    const custom = new SourceProviders({ githubHost: 'github.example.com', gitlabHost: 'gitlab.example.com' });
    expect(custom.resolve({ provider: 'github', ref: 'o/r#1' }).url).toBe('https://github.example.com/o/r/issues/1');
    expect(custom.resolve({ provider: 'gitlab', ref: 'g/p#1' }).url).toBe('https://gitlab.example.com/g/p/-/issues/1');
  });

  describe('resolve', () => {
    it('turns a reference into a complete source with the provider label', () => {
      expect(providers.resolve({ provider: 'github', ref: 'example-org/shop-demo#42' })).toEqual({
        provider: 'github',
        ref: 'example-org/shop-demo#42',
        url: 'https://github.com/example-org/shop-demo/issues/42',
        label: 'example-org/shop-demo#42',
      });
      expect(providers.resolve({ provider: 'jira', ref: 'SHOP-7' })).toEqual({
        provider: 'jira',
        ref: 'SHOP-7',
        url: 'https://jira.example.com/browse/SHOP-7',
        label: 'SHOP-7',
      });
      expect(providers.resolve({ provider: 'url', ref: 'https://tickets.example.com/1' })).toMatchObject({ label: 'tickets.example.com' });
    });

    it('keeps an explicit label and an explicit url (which still has to be https)', () => {
      expect(providers.resolve({ provider: 'github', ref: 'o/r#1', label: 'Checkout fix' }).label).toBe('Checkout fix');
      expect(providers.resolve({ provider: 'url', url: 'https://tickets.example.com/9', label: 'Ticket 9' })).toEqual({
        provider: 'url',
        url: 'https://tickets.example.com/9',
        label: 'Ticket 9',
      });
      // An explicit url wins over resolving the reference.
      expect(providers.resolve({ provider: 'github', ref: 'o/r#1', url: 'https://github.com/o/r/pull/1' }).url).toBe(
        'https://github.com/o/r/pull/1',
      );
      // Without a reference or label, only the link is kept.
      expect(providers.resolve({ provider: 'url', url: 'https://tickets.example.com/9' })).toEqual({
        provider: 'url',
        url: 'https://tickets.example.com/9',
      });
    });

    it('names the offending field in every error', () => {
      expect(() => providers.resolve({ provider: 'mystery', ref: 'x' }, 'context.sources[2]')).toThrow(
        'context.sources[2].provider must be one of github, gitlab, url, jira',
      );
      expect(() => providers.resolve({ provider: 'github' }, 'suite.subject')).toThrow('suite.subject needs a ref or a url');
      expect(() => providers.resolve({ provider: 'github', ref: 'not a ref' }, 'suite.subject')).toThrow(
        'suite.subject.ref is not a valid GitHub reference',
      );
      expect(() => providers.resolve({ provider: 'jira', ref: 'a b' })).toThrow('source.ref is not a valid Jira reference');
      expect(() => providers.resolve({ provider: 'github', ref: 'o/r#1' }, undefined)).not.toThrow();
    });

    it('only ever produces https links', () => {
      for (const url of [
        'http://tickets.example.com/1',
        'javascript:alert(1)',
        'https://u:p@tickets.example.com/',
        'https://tickets.example.com/#x',
        'not a url',
      ])
        expect(() => providers.resolve({ provider: 'url', url }, 'source')).toThrow(/source\.url is (unsafe|invalid)/);
      expect(() => providers.resolve({ provider: 'github', ref: 'o/r#1', url: 'http://github.com/o/r/pull/1' })).toThrow(/unsafe/);
    });
  });

  describe('parse', () => {
    it('splits <provider>:<reference> at the first colon', () => {
      expect(providers.parse('github:example-org/shop-demo#42')).toEqual({ provider: 'github', ref: 'example-org/shop-demo#42' });
      expect(providers.parse('url:https://tickets.example.com/1')).toEqual({ provider: 'url', ref: 'https://tickets.example.com/1' });
    });

    it('explains the expected shape', () => {
      for (const bad of ['', 'github', 'github:', ':example-org/shop-demo#42'])
        expect(() => providers.parse(bad)).toThrow('--source must look like <provider>:<reference>, e.g. github:owner/repo#12');
      expect(() => providers.parse('nope', 'source[0]')).toThrow(/^source\[0\] must look like/);
    });

    it('does not check the provider: resolve() does', () => {
      const input = providers.parse('mystery:abc');
      expect(() => providers.resolve(input)).toThrow(/must be one of/);
    });
  });
});

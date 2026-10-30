import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildReplayContext, readContextFile } from '../src/capture/context.ts';
import { compileContextSchema } from '../src/server/context-schema.ts';
import { assertReplayContext, assertSafeUrl, MAX_SOURCES } from '../src/shared/context.ts';
import { SourceProviders } from '../src/shared/source-providers.ts';

const CAPTURED_AT = '2026-10-10T12:00:00.000Z';

/** The message a context is refused with, or a marker when it is accepted. */
const contextError = (value: unknown) => {
  try {
    assertReplayContext(value);
    return 'the context was accepted';
  } catch (error) {
    return (error as Error).message;
  }
};

const valid = (extra: Record<string, unknown> = {}) => ({ version: 1, capturedAt: CAPTURED_AT, ...extra });

describe('assertReplayContext: accepted contexts', () => {
  it('accepts the minimal context and a fully populated one', () => {
    expect(() => assertReplayContext(valid())).not.toThrow();
    expect(() =>
      assertReplayContext(
        valid({
          app: {
            name: 'Shop Demo',
            environment: 'staging',
            origin: 'https://shop.example.com',
            version: '2026.10.10+build.7',
            commit: 'a1b2c3d4e5f6789',
          },
          test: { suite: 'checkout', case: 'applies a coupon (retry 1)', runId: 'run-17' },
          sources: [
            {
              provider: 'github',
              ref: 'example-org/shop-demo#42',
              url: 'https://github.com/example-org/shop-demo/issues/42',
              label: 'Coupon fix',
            },
            { provider: 'url', url: 'https://tickets.example.com/browse/SHOP-7' },
          ],
          fields: { feature: 'coupons', retries: 2, flags: ['a', 'b'], nested: { ok: true, none: null } },
        }),
      ),
    ).not.toThrow();
    expect(() => assertReplayContext(valid({ app: { origin: 'http://localhost:5173' } }))).not.toThrow();
  });
});

const deep = (levels: number) => Array.from({ length: levels }).reduce<Record<string, unknown>>((inner) => ({ n: inner }), { leaf: 1 });

const text = (length: number) => 'x'.repeat(length);

const fields = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${i}`, text(3000)]));

describe('assertReplayContext: rejections', () => {
  it('requires an object with version 1 and a parseable capture time', () => {
    for (const bad of [undefined, null, 'text', 3, [], [valid()]]) expect(contextError(bad)).toMatch('replay.context must be an object');
    expect(contextError(valid({ version: 2 }))).toMatch('replay.context.version is unsupported');
    expect(contextError({ capturedAt: CAPTURED_AT })).toMatch('replay.context.version is unsupported');
    expect(contextError({ version: 1 })).toMatch('replay.context.capturedAt is invalid');
    expect(contextError({ version: 1, capturedAt: 'yesterday' })).toMatch('replay.context.capturedAt is invalid');
    expect(contextError({ version: 1, capturedAt: 12345 })).toMatch('replay.context.capturedAt is invalid');
  });

  it('refuses unknown top-level keys, naming them', () => {
    expect(contextError(valid({ account: { id: 1 }, extra: true }))).toMatch('replay.context contains unsupported fields: account, extra');
  });

  it('checks the app block', () => {
    expect(contextError(valid({ app: 'Shop' }))).toMatch('replay.context.app must be an object');
    expect(contextError(valid({ app: { product: 'Shop' } }))).toMatch('replay.context.app contains unsupported fields: product');
    expect(contextError(valid({ app: { name: '' } }))).toMatch('replay.context.app.name is invalid');
    expect(contextError(valid({ app: { name: 'x'.repeat(81) } }))).toMatch('replay.context.app.name is invalid');
    expect(contextError(valid({ app: { name: 'Shop <b>' } }))).toMatch('replay.context.app.name is invalid');
    expect(contextError(valid({ app: { environment: 'has space' } }))).toMatch('replay.context.app.environment is invalid');
    expect(contextError(valid({ app: { version: '1.0 beta' } }))).toMatch('replay.context.app.version is invalid');
    expect(contextError(valid({ app: { commit: 'zzzzzzz' } }))).toMatch('replay.context.app.commit is invalid');
    expect(contextError(valid({ app: { commit: 'abc12' } }))).toMatch('replay.context.app.commit is invalid');
  });

  it('accepts only a bare http(s) origin, without credentials or a path', () => {
    expect(contextError(valid({ app: { origin: 'not a url' } }))).toMatch('replay.context.app.origin is invalid');
    expect(contextError(valid({ app: { origin: 'ftp://example.com' } }))).toMatch(
      'replay.context.app.origin must be a bare http(s) origin',
    );
    expect(contextError(valid({ app: { origin: 'https://example.com/path' } }))).toMatch(
      'replay.context.app.origin must be a bare http(s) origin',
    );
    expect(contextError(valid({ app: { origin: 'https://example.com/' } }))).toMatch(
      'replay.context.app.origin must be a bare http(s) origin',
    );
    expect(contextError(valid({ app: { origin: 'https://user:pw@example.com' } }))).toMatch(
      'replay.context.app.origin must be a bare http(s) origin',
    );
  });

  it('checks the test block', () => {
    expect(contextError(valid({ test: [] }))).toMatch('replay.context.test must be an object');
    expect(contextError(valid({ test: { name: 'x' } }))).toMatch('replay.context.test contains unsupported fields: name');
    expect(contextError(valid({ test: { suite: '' } }))).toMatch('replay.context.test.suite is invalid');
    expect(contextError(valid({ test: { case: 'x'.repeat(121) } }))).toMatch('replay.context.test.case is invalid');
    expect(contextError(valid({ test: { runId: 'run<1>' } }))).toMatch('replay.context.test.runId is invalid');
  });

  it('checks every source: provider, https link without credentials or fragment, ref, label', () => {
    const source = (extra: Record<string, unknown>) =>
      valid({ sources: [{ provider: 'url', url: 'https://tickets.example.com/1', ...extra }] });
    expect(() => assertReplayContext(source({}))).not.toThrow();
    expect(contextError(valid({ sources: 'x' }))).toMatch(`replay.context.sources must contain at most ${MAX_SOURCES} entries`);
    expect(
      contextError(valid({ sources: Array.from({ length: MAX_SOURCES + 1 }, () => ({ provider: 'url', url: 'https://example.com/' })) })),
    ).toMatch('at most 10 entries');
    expect(contextError(valid({ sources: ['x'] }))).toMatch('replay.context.sources[0] must be an object');
    expect(contextError(source({ kind: 'ticket' }))).toMatch('replay.context.sources[0] contains unsupported fields: kind');
    expect(contextError(source({ provider: 'Not A Provider' }))).toMatch('replay.context.sources[0].provider is invalid');
    expect(contextError(source({ url: undefined }))).toMatch('replay.context.sources[0].url is invalid');
    expect(contextError(source({ url: 'http://tickets.example.com/1' }))).toMatch('replay.context.sources[0].url is unsafe');
    expect(contextError(source({ url: 'javascript:alert(1)' }))).toMatch('replay.context.sources[0].url is unsafe');
    expect(contextError(source({ url: 'https://u:p@tickets.example.com/1' }))).toMatch('replay.context.sources[0].url is unsafe');
    expect(contextError(source({ url: 'https://tickets.example.com/1#frag' }))).toMatch('replay.context.sources[0].url is unsafe');
    expect(contextError(source({ url: 'nope' }))).toMatch('replay.context.sources[0].url is invalid');
    expect(contextError(source({ ref: 'has space' }))).toMatch('replay.context.sources[0].ref is invalid');
    expect(contextError(source({ label: 'bad <label>' }))).toMatch('replay.context.sources[0].label is invalid');
    expect(contextError(source({ label: 'x'.repeat(81) }))).toMatch('replay.context.sources[0].label is invalid');
    expect(
      contextError(
        valid({
          sources: [
            { provider: 'url', url: 'https://example.com/' },
            { provider: 'url', url: 'http://example.com/' },
          ],
        }),
      ),
    ).toMatch('sources[1].url is unsafe');
  });

  it('checks fields: an object of plain JSON', () => {
    expect(contextError(valid({ fields: [] }))).toMatch('replay.context.fields must be an object');
    expect(contextError(valid({ fields: 'x' }))).toMatch('replay.context.fields must be an object');
    expect(contextError(valid({ fields: { n: Number.POSITIVE_INFINITY } }))).toMatch('replay.context.fields.n must be a finite number');
    expect(contextError(valid({ fields: { f: () => 1 } }))).toMatch('replay.context.fields.f must be plain JSON');
    expect(contextError(valid({ fields: { u: undefined } }))).toMatch('replay.context.fields.u must be plain JSON');
    expect(contextError(valid({ fields: { big: 10n } }))).toMatch('must be plain JSON');
  });

  it('bounds fields: depth, breadth, key length, forbidden keys', () => {
    expect(() => assertReplayContext(valid({ fields: deep(5) }))).not.toThrow();
    expect(contextError(valid({ fields: deep(8) }))).toMatch(/is nested too deeply/);
    expect(() => assertReplayContext(valid({ fields: { list: Array.from({ length: 200 }, (_, i) => i) } }))).not.toThrow();
    expect(contextError(valid({ fields: { list: Array.from({ length: 201 }, (_, i) => i) } }))).toMatch(
      'replay.context.fields.list has too many entries',
    );
    const many = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, 1]));
    expect(contextError(valid({ fields: many }))).toMatch('replay.context.fields has too many keys');
    expect(contextError(valid({ fields: { ['k'.repeat(81)]: 1 } }))).toMatch('replay.context.fields has an invalid key');
    expect(contextError(valid({ fields: JSON.parse('{"__proto__": {"admin": true}}') }))).toMatch(
      'replay.context.fields has an invalid key',
    );
  });

  it('keeps the whole context under 16 KB', () => {
    // 3 x 3000 characters is fine; 6 x 3000 is not (each value is within every other bound).
    expect(() => assertReplayContext(valid({ fields: fields(3) }))).not.toThrow();
    expect(contextError(valid({ fields: fields(6) }))).toMatch('replay.context exceeds 16 KB');
  });
});

describe('assertSafeUrl', () => {
  it('returns the parsed URL for an https link and names the field otherwise', () => {
    expect(assertSafeUrl('https://example.com/a?b=1', 'link').hostname).toBe('example.com');
    expect(() => assertSafeUrl('http://example.com', 'link')).toThrow('link is unsafe');
    expect(() => assertSafeUrl(42, 'link')).toThrow('link is invalid');
    expect(() => assertSafeUrl(`https://example.com/${'a'.repeat(2100)}`, 'link')).toThrow('link is invalid');
  });
});

describe('buildReplayContext', () => {
  it('builds a context from a runner file and stamps the fallback capture time', () => {
    const context = buildReplayContext(
      {
        app: { name: 'Shop Demo', environment: 'ci' },
        test: { suite: 'checkout', case: 'applies a coupon' },
        fields: { feature: 'coupons' },
      },
      CAPTURED_AT,
    );
    expect(context).toEqual({
      version: 1,
      capturedAt: CAPTURED_AT,
      app: { name: 'Shop Demo', environment: 'ci' },
      test: { suite: 'checkout', case: 'applies a coupon' },
      fields: { feature: 'coupons' },
    });
  });

  it('prefers the capture time the runner supplied', () => {
    expect(buildReplayContext({ capturedAt: '2026-01-01T00:00:00.000Z' }, CAPTURED_AT).capturedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('resolves source references with the built-in providers, or with the ones passed in', () => {
    const context = buildReplayContext(
      {
        sources: [
          { provider: 'github', ref: 'example-org/shop-demo#42' },
          { provider: 'url', url: 'https://tickets.example.com/browse/SHOP-7', label: 'Ticket SHOP-7' },
          { provider: 'jira', ref: 'SHOP-9' },
        ],
      },
      CAPTURED_AT,
      { sources: new SourceProviders({ templates: [{ id: 'jira', template: 'https://jira.example.com/browse/{ref}' }] }) },
    );
    expect(context.sources).toEqual([
      {
        provider: 'github',
        ref: 'example-org/shop-demo#42',
        url: 'https://github.com/example-org/shop-demo/issues/42',
        label: 'example-org/shop-demo#42',
      },
      { provider: 'url', url: 'https://tickets.example.com/browse/SHOP-7', label: 'Ticket SHOP-7' },
      { provider: 'jira', ref: 'SHOP-9', url: 'https://jira.example.com/browse/SHOP-9', label: 'SHOP-9' },
    ]);
    expect(() => buildReplayContext({ sources: [{ provider: 'jira', ref: 'SHOP-9' }] }, CAPTURED_AT)).toThrow(
      'context.sources[0].provider must be one of github, gitlab, url',
    );
  });

  it('rejects what is not a context file, naming the problem', () => {
    for (const bad of [null, undefined, 'text', 1, []])
      expect(() => buildReplayContext(bad, CAPTURED_AT)).toThrow('the context file must be a JSON object');
    expect(() => buildReplayContext({ account: {}, flags: [] }, CAPTURED_AT)).toThrow(
      'the context file has unsupported keys: account, flags',
    );
    expect(() => buildReplayContext({ app: { name: '' } }, CAPTURED_AT)).toThrow('replay.context.app.name is invalid');
    expect(() => buildReplayContext({ sources: [{ provider: 'github', ref: 'nope' }] }, CAPTURED_AT)).toThrow(
      'context.sources[0].ref is not a valid GitHub reference',
    );
    expect(() => buildReplayContext({ fields: [1] }, CAPTURED_AT)).toThrow('replay.context.fields must be an object');
    // Non-array `sources` become an empty list rather than being passed through unchecked.
    expect(buildReplayContext({ sources: 'x' }, CAPTURED_AT).sources).toEqual([]);
  });

  it('validates fields against the deployment schema the same way the server does', () => {
    const schema = compileContextSchema({
      type: 'object',
      required: ['feature'],
      additionalProperties: false,
      properties: { feature: { type: 'string', enum: ['coupons', 'checkout'] }, retries: { type: 'integer', minimum: 0 } },
    });
    expect(buildReplayContext({ fields: { feature: 'coupons', retries: 1 } }, CAPTURED_AT, { schema }).fields).toEqual({
      feature: 'coupons',
      retries: 1,
    });
    expect(() => buildReplayContext({ fields: { feature: 'other' } }, CAPTURED_AT, { schema })).toThrow(
      /^context\.fields\.feature must be equal to one of the allowed values$/,
    );
    expect(() => buildReplayContext({ fields: { feature: 'coupons', retries: -1 } }, CAPTURED_AT, { schema })).toThrow(
      'context.fields.retries must be >= 0',
    );
    expect(() => buildReplayContext({ fields: { feature: 'coupons', extra: 1 } }, CAPTURED_AT, { schema })).toThrow(
      /must NOT have additional properties/,
    );
    expect(() => buildReplayContext({ fields: {} }, CAPTURED_AT, { schema })).toThrow(/required property 'feature'/);
    // The schema is not consulted when the runner supplies no fields.
    expect(buildReplayContext({ app: { name: 'Shop Demo' } }, CAPTURED_AT, { schema }).fields).toBeUndefined();
  });
});

describe('readContextFile', () => {
  it('returns undefined without a path, parses JSON, and refuses a file over 16 KB', async () => {
    await expect(readContextFile(undefined)).resolves.toBeUndefined();
    const dir = await mkdtemp(join(tmpdir(), 'replays-context-file-'));
    const file = join(dir, 'context.json');
    await writeFile(file, JSON.stringify({ app: { name: 'Shop Demo' } }));
    await expect(readContextFile(file)).resolves.toEqual({ app: { name: 'Shop Demo' } });
    await writeFile(file, JSON.stringify({ fields: { text: 'x'.repeat(17_000) } }));
    await expect(readContextFile(file)).rejects.toThrow('--context-file must be at most 16 KB');
    await writeFile(file, '{not json');
    await expect(readContextFile(file)).rejects.toThrow(/JSON/);
    await expect(readContextFile(join(dir, 'missing.json'))).rejects.toThrow(/ENOENT/);
  });
});

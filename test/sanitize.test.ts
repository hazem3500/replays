import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { MASK_INPUT_OPTIONS, maskCapturedInputs } from '../src/capture/mask-inputs.ts';
import {
  networkEntries,
  sanitizeHar,
  sanitizeHeaders,
  sanitizeReplayBundle,
  sanitizeUrl,
  sanitizeUrlFields,
} from '../src/capture/sanitize.ts';
import { assertRedactionRules, type RedactionRules } from '../src/shared/redaction.ts';
import { hasNoResponse, isFailedRequest, type ReplayBundle } from '../src/shared/replay.ts';
import { replay } from './fixtures.ts';

describe('HAR sanitization', () => {
  const source = {
    log: {
      entries: [
        {
          startedDateTime: '2026-10-06T00:00:01.000Z',
          time: 24,
          request: {
            method: 'POST',
            url: 'https://example.com/data?token=secret&view=all',
            headers: [
              { name: 'Authorization', value: 'Bearer secret' },
              { name: 'Accept', value: 'application/json' },
              { name: 'Referer', value: 'https://example.com/source?access_token=secret&view=all' },
            ],
            cookies: [{ name: 'session', value: 'secret' }],
            postData: { text: 'password=secret', params: [{ name: 'password', value: 'secret' }] },
          },
          response: {
            status: 401,
            statusText: 'Unauthorized',
            headers: [
              { name: 'Set-Cookie', value: 'session=secret' },
              { name: 'Content-Type', value: 'application/json' },
              { name: 'Location', value: '/login?token=secret&next=%2Fhome' },
            ],
            cookies: [{ name: 'session', value: 'secret' }],
            content: { mimeType: 'application/json', text: '{"token":"secret"}' },
          },
        },
      ],
    },
  };

  it('strips credentials, cookies, bodies, and sensitive query values', () => {
    const sanitized = sanitizeHar(source);
    const entry = sanitized.log!.entries![0]!;
    expect(entry.request!.headers).toEqual([
      { name: 'Accept', value: 'application/json' },
      { name: 'Referer', value: 'https://example.com/source?access_token=%5Bredacted%5D&view=all' },
    ]);
    expect(entry.response!.headers).toEqual([
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Location', value: '/login?token=%5Bredacted%5D&next=%2Fhome' },
    ]);
    expect(entry.request!.cookies).toEqual([]);
    expect(entry.response!.cookies).toEqual([]);
    expect(entry.request!.postData).not.toHaveProperty('text');
    expect(entry.response!.content).not.toHaveProperty('text');
    expect(entry.request!.url).toContain('token=%5Bredacted%5D');
    expect(JSON.stringify(sanitized)).not.toContain('secret');
  });

  it('turns sanitized HAR rows into the viewer network track', () => {
    const entries = networkEntries(source, Date.parse('2026-10-06T00:00:00.000Z'));
    expect(entries[0]).toMatchObject({ at: 1000, method: 'POST', status: 401, duration: 24 });
  });

  it('removes URL credentials', () => {
    expect(sanitizeUrl('https://user:pass@example.com/path')).toBe('https://example.com/path');
  });

  it('redacts sensitive values from URL fragments', () => {
    const oauth = sanitizeUrl('https://example.com/callback#access_token=fragment-secret&state=ok');
    const routed = sanitizeUrl('https://example.com/#/callback?code=route-secret&view=all');

    expect(oauth).toContain('access_token=%5Bredacted%5D');
    expect(oauth).not.toContain('fragment-secret');
    expect(routed).toContain('code=%5Bredacted%5D');
    expect(routed).not.toContain('route-secret');
  });

  it('redacts api_token and other *_token, *_secret and *_password query values', () => {
    const url = sanitizeUrl('https://example.com/api/reports?week=41&api_token=track-secret&csrf-token=t&db_password=p&view=all');

    expect(url).toContain('api_token=%5Bredacted%5D');
    expect(url).toContain('csrf-token=%5Bredacted%5D');
    expect(url).toContain('db_password=%5Bredacted%5D');
    expect(url).toContain('week=41');
    expect(url).toContain('view=all');
    expect(url).not.toContain('track-secret');
  });

  it('redacts an email mirrored into a link query while the user types', () => {
    const url = sanitizeUrl('https://accounts.example.com/signup?email=person%40example.com&next=%2Fcalendar');

    expect(url).toContain('email=%5Bredacted%5D');
    expect(url).toContain('next=%2Fcalendar');
    expect(url).not.toContain('person');
  });

  it('redacts rrweb Meta hrefs and nested URL-bearing event fields', () => {
    const event = sanitizeUrlFields({
      type: 4,
      data: {
        href: 'https://example.com/page?token=meta-secret',
        node: {
          attributes: {
            href: '/next?access_token=href-secret',
            src: 'https://cdn.example.com/image.png?api_key=src-secret',
          },
          url: 'https://example.com/fetch?client_secret=url-secret',
        },
      },
    });

    expect(event.data.href).toContain('token=%5Bredacted%5D');
    expect(event.data.node.attributes.href).toContain('access_token=%5Bredacted%5D');
    expect(event.data.node.attributes.src).toContain('api_key=%5Bredacted%5D');
    expect(event.data.node.url).toContain('client_secret=%5Bredacted%5D');
    expect(JSON.stringify(event)).not.toContain('meta-secret');
    expect(JSON.stringify(event)).not.toContain('href-secret');
    expect(JSON.stringify(event)).not.toContain('src-secret');
    expect(JSON.stringify(event)).not.toContain('url-secret');
  });
});

// Shapes taken from an agent-browser 0.38 HAR: the 3xx response is dropped, so
// the hop is a status-0 entry with no headers; real failures carry net::ERR_*.
const harEntry = (url: string, status: number, statusText: string) => ({
  startedDateTime: '2026-10-11T03:10:31.792Z',
  time: 0,
  request: { method: 'GET', url, headers: [] },
  response: { status, statusText, headers: [] },
});

describe('agent-browser redirect hops', () => {
  const [hop, dns, reset, missing, ok] = networkEntries(
    {
      log: {
        entries: [
          harEntry('https://example.com/old/pricing', 0, ''),
          harEntry('http://nope.invalid/x', 0, 'net::ERR_NAME_NOT_RESOLVED'),
          harEntry('https://a.test/hang', 0, 'net::ERR_EMPTY_RESPONSE'),
          harEntry('https://a.test/missing', 404, 'Not Found'),
          harEntry('https://example.com/pricing', 200, 'OK'),
        ],
      },
    },
    Date.parse('2026-10-11T03:10:31.000Z'),
  );

  it('does not count a redirect hop as a failed request', () => {
    expect(hasNoResponse(hop!)).toBe(true);
    expect(isFailedRequest(hop!)).toBe(false);
  });

  it('still counts network failures and HTTP errors', () => {
    expect([dns, reset, missing].map((request) => isFailedRequest(request!))).toEqual([true, true, true]);
    expect([dns, reset, missing].some((request) => hasNoResponse(request!))).toBe(false);
    expect(isFailedRequest(ok!)).toBe(false);
  });
});

describe('URLs outside URL-named fields', () => {
  it('redacts sensitive values in srcset, ping, style, CSS text, meta content and plugin payloads', () => {
    const events = sanitizeUrlFields([
      {
        type: 2,
        data: {
          node: {
            attributes: {
              srcset: 'https://cdn.example.com/a.png?token=srcset-secret 1x, https://cdn.example.com/b.png 2x',
              ping: 'https://t.example.com/p?api_token=ping-secret',
              style: 'background:url("https://example.com/bg.png?access_token=style-secret")',
              _cssText: '.a{background:url(https://example.com/i.png?X-Amz-Signature=css-secret)}',
              content: '0;url=https://example.com/?code=meta-secret',
              'xlink:href': '/sprite.svg?token=xlink-secret#icon',
            },
          },
        },
      },
      {
        type: 3,
        data: {
          source: 0,
          attributes: [{ id: 2, attributes: { style: { background: 'url(https://example.com/?token=mutation-secret)' } } }],
        },
      },
      { type: 6, data: { plugin: 'rrweb/console@1', payload: { payload: ['"https://user:pw-secret@example.com/x"'] } } },
    ]);
    const serialized = JSON.stringify(events);
    for (const secret of [
      'srcset-secret',
      'ping-secret',
      'style-secret',
      'css-secret',
      'meta-secret',
      'xlink-secret',
      'mutation-secret',
      'pw-secret',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain('https://cdn.example.com/b.png 2x');
  });

  it('redacts relative URLs in srcset and CSS url(), keeping their form', () => {
    const [snapshot, mutation] = sanitizeUrlFields([
      {
        type: 2,
        data: {
          node: {
            attributes: {
              srcset: '/a.png?token=srcset-secret 1x, img/b.png?w=2,3&api_key=key-secret 2x,../c.png 3x',
              imagesrcset: '?signature=preload-secret 1x',
              style: "background:url('../bg.png?access_token=style-secret#x') no-repeat",
              _cssText: '.a{background:url(i.png?X-Amz-Signature=css-secret)}.b{background:url(/plain.png?v=1)}',
            },
          },
        },
      },
      {
        type: 3,
        data: {
          source: 0,
          attributes: [{ id: 2, attributes: { style: { 'background-image': 'url(//cdn.example.com/x.png?token=mutation-secret)' } } }],
        },
      },
    ]);
    const serialized = JSON.stringify([snapshot, mutation]);
    for (const secret of ['srcset-secret', 'key-secret', 'preload-secret', 'style-secret', 'css-secret', 'mutation-secret']) {
      expect(serialized).not.toContain(secret);
    }
    const attributes = (snapshot as { data: { node: { attributes: Record<string, string> } } }).data.node.attributes;
    expect(attributes.srcset).toBe('/a.png?token=%5Bredacted%5D 1x, img/b.png?w=2%2C3&api_key=%5Bredacted%5D 2x,../c.png 3x');
    expect(attributes.style).toBe("background:url('../bg.png?access_token=%5Bredacted%5D#x') no-repeat");
    expect(attributes._cssText).toContain('url(/plain.png?v=1)');
    expect(sanitizeUrlFields(snapshot)).toEqual(snapshot);
  });

  it('leaves text without sensitive URLs byte-for-byte unchanged', () => {
    const text = 'see https://example.com?view=all and http://a.test/path, then https://b.test/?page=2';
    expect(sanitizeUrlFields({ message: text })).toEqual({ message: text });
  });

  it('keeps query-only relative URLs relative', () => {
    expect(sanitizeUrl('?page=2&token=secret')).toBe('?page=2&token=%5Bredacted%5D');
    expect(sanitizeUrl('?page=2')).toBe('?page=2');
  });

  it('redacts presigned URL signatures and JWT query values', () => {
    const url = sanitizeUrl('https://bucket.example.com/a.png?X-Amz-Signature=s1&signature=s2&jwt=s3&w=10');
    expect(url).not.toMatch(/s1|s2|s3/);
    expect(url).toContain('w=10');
  });
});

describe('sanitizeHeaders', () => {
  it('drops proxy assertions, CSRF and other *-token / *-secret headers', () => {
    expect(
      sanitizeHeaders([
        { name: 'X-Proxy-JWT-Assertion', value: 'assertion' },
        { name: 'X-CSRF-Token', value: 'csrf' },
        { name: 'x-amz-security-token', value: 'amz' },
        { name: 'X-Client-Secret', value: 'cs' },
        { name: 'Accept', value: 'application/json' },
      ]),
    ).toEqual([{ name: 'Accept', value: 'application/json' }]);
  });
});

const leakyTracks = () => {
  const bundle = replay('leaky-tracks');
  bundle.steps = [{ at: 0, kind: 'open', label: 'Open https://app.example.com/?api_token=label-secret' }];
  bundle.console = [{ at: 0, level: 'error', message: 'GET https://api.example.com/me?api_token=console-secret 401' }];
  bundle.network = [
    {
      id: 'request-1',
      at: 0,
      duration: 1,
      method: 'POST',
      url: 'https://api.example.com/me',
      status: 200,
      statusText: 'OK',
      requestHeaders: [],
      responseHeaders: [],
      // Raw HAR fields a client might leave on an entry.
      request: { postData: { text: 'password=body-secret' }, cookies: [{ name: 'sid', value: 'cookie-secret' }] },
      response: { content: { text: 'response-secret' } },
    } as ReplayBundle['network'][number],
  ];
  return bundle;
};

describe('sanitizeReplayBundle', () => {
  it('redacts URLs in console messages and step labels and keeps only known network fields', () => {
    const clean = sanitizeReplayBundle(leakyTracks());
    const serialized = JSON.stringify(clean);
    for (const secret of ['label-secret', 'console-secret', 'body-secret', 'cookie-secret', 'response-secret']) {
      expect(serialized).not.toContain(secret);
    }
    expect(Object.keys(clean.network[0]!)).toEqual([
      'id',
      'at',
      'duration',
      'method',
      'url',
      'status',
      'statusText',
      'requestHeaders',
      'responseHeaders',
    ]);
    expect(sanitizeReplayBundle(structuredClone(clean))).toEqual(clean);
  });
});

const hiddenInput = (id: number, value: string) => ({
  type: 2,
  id,
  tagName: 'input',
  attributes: { type: 'hidden', name: 'csrf_token', value },
  childNodes: [],
});

describe('hidden inputs', () => {
  it('masks hidden input values in snapshots, added nodes, attribute changes and input events', () => {
    const events = maskCapturedInputs([
      { type: 2, data: { node: { type: 0, id: 1, childNodes: [hiddenInput(2, 'snapshot-csrf')] } } },
      { type: 3, data: { source: 0, adds: [{ parentId: 1, node: hiddenInput(3, 'added-csrf') }], removes: [], texts: [], attributes: [] } },
      { type: 3, data: { source: 0, adds: [], removes: [], texts: [], attributes: [{ id: 2, attributes: { value: 'rotated-csrf' } }] } },
      { type: 3, data: { source: 5, id: 3, text: 'input-csrf' } },
    ]);
    const serialized = JSON.stringify(events);
    for (const secret of ['snapshot-csrf', 'added-csrf', 'rotated-csrf', 'input-csrf']) expect(serialized).not.toContain(secret);
    expect(maskCapturedInputs(structuredClone(events))).toEqual(events);
  });

  it('records hidden inputs masked in the capture recorder too', async () => {
    expect(MASK_INPUT_OPTIONS).toMatchObject({ hidden: true, password: true, text: true, textarea: true, select: true });
    const source = await readFile(new URL('../src/capture/injected-recorder.ts', import.meta.url), 'utf8');
    expect(source).toContain('maskInputOptions: MASK_INPUT_OPTIONS');
    expect(source).not.toContain('maskAllInputs: true');
  });
});

// Everything the default pass removes, in one bundle: auth headers, sensitive query values, URL credentials, typed input.
const leakyEverywhere = (): ReplayBundle => {
  const bundle = replay('never-weaker');
  bundle.meta.url = 'https://user:userinfo-secret@app.example.com/?token=query-secret#access_token=hash-secret';
  bundle.events = [
    { type: 4, timestamp: 1000, data: { href: 'https://app.example.com/?token=query-secret' } },
    {
      type: 2,
      timestamp: 1001,
      data: {
        node: {
          type: 2,
          id: 1,
          tagName: 'form',
          attributes: { action: '/login?password=query-secret' },
          childNodes: [{ type: 2, id: 2, tagName: 'input', attributes: { type: 'password', value: 'input-secret' }, childNodes: [] }],
        },
      },
    },
  ] as ReplayBundle['events'];
  bundle.console = [{ at: 0, level: 'log', message: 'GET https://api.example.com/?api_token=console-secret' }];
  bundle.steps = [{ at: 0, kind: 'open', label: 'Open https://app.example.com/?token=query-secret' }];
  bundle.network = [
    {
      id: 'request-1',
      at: 0,
      duration: 1,
      method: 'POST',
      url: 'https://api.example.com/me?session=query-secret',
      status: 200,
      statusText: 'OK',
      requestHeaders: [
        { name: 'Authorization', value: 'Bearer header-secret' },
        { name: 'Referer', value: 'https://app.example.com/?code=query-secret' },
      ],
      responseHeaders: [{ name: 'Set-Cookie', value: 'sid=header-secret' }],
      request: { postData: { text: 'password=body-secret' } },
    } as ReplayBundle['network'][number],
  ];
  return bundle;
};

describe('redaction rules never weaken the defaults', () => {
  const secrets = ['header-secret', 'query-secret', 'hash-secret', 'userinfo-secret', 'input-secret', 'console-secret', 'body-secret'];

  // Rule sets that try to get something back: rename what the defaults look for, rewrite their markers, match nothing
  // or everything.
  const ruleSets: RedactionRules[] = [
    {},
    { headers: [], queryParams: [], jsonKeys: [], text: [], maskSelectors: [] },
    {
      text: [
        { pattern: /token=/g, replace: 'tkn=' },
        { pattern: 'Authorization', replace: 'Accept' },
      ],
    },
    {
      text: [
        { pattern: /%5Bredacted%5D|\[redacted\]/, replace: 'ok' },
        { pattern: /\*+/, replace: 'plain' },
      ],
    },
    { text: [{ pattern: 'https://', replace: 'hxxps://' }] },
    { headers: [/.*/], queryParams: [/.*/], jsonKeys: [/.*/], text: [{ pattern: /secret/g }], maskSelectors: ['*'] },
    { headers: ['accept'], queryParams: ['view'], jsonKeys: ['id'], maskSelectors: ['form', '[data-private]'] },
  ];

  it.each(ruleSets.map((rules, index) => [index, rules] as const))('rule set %i still removes every default secret', (_index, rules) => {
    const clean = sanitizeReplayBundle(leakyEverywhere(), rules);
    const serialized = JSON.stringify(clean);
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    // The result is always a fixed point of the default pass: nothing is left for the defaults to remove.
    expect(sanitizeReplayBundle(structuredClone(clean))).toEqual(clean);
  });

  it('cannot switch a default off: there is no such key, and unknown keys are refused', () => {
    for (const attempt of [{ defaults: false }, { headers: { allow: ['authorization'] } }, { allowHeaders: ['cookie'] }, { text: 'off' }])
      expect(() => assertRedactionRules(attempt)).toThrow(/unknown keys|must be an array/);
    expect(() => sanitizeReplayBundle(leakyEverywhere(), { defaults: false } as RedactionRules)).toThrow(/unknown keys: defaults/);
  });

  it('adds to the defaults on the other entry points too (headers, URLs)', () => {
    const rules: RedactionRules = { headers: [/^x-acme-session$/i], queryParams: ['invite_token'] };
    expect(
      sanitizeHeaders(
        [
          { name: 'Cookie', value: 'c' },
          { name: 'X-Acme-Session', value: 's' },
          { name: 'Accept', value: 'a' },
        ],
        rules,
      ),
    ).toEqual([{ name: 'Accept', value: 'a' }]);
    expect(sanitizeUrl('https://x.example/?invite_token=abc&token=t&view=1', rules)).toBe(
      'https://x.example/?invite_token=%5Bredacted%5D&token=%5Bredacted%5D&view=1',
    );
    expect(sanitizeUrlFields({ href: '/a?invite_token=abc' }, rules)).toEqual({ href: '/a?invite_token=%5Bredacted%5D' });
  });
});

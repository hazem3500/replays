// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createAttributeMasker, redactEventUrls } from './sanitize-events.ts';
import { filterHeaders, redactUrl } from './redact.ts';
import type { ReplayRrwebEvent } from './bundle-types.ts';

const snapshot = (): ReplayRrwebEvent => ({
  type: 2,
  timestamp: 0,
  data: {
    node: {
      type: 0,
      childNodes: [
        { type: 2, id: 1, tagName: 'input', attributes: { type: 'text', value: 'My ordinary title', placeholder: 'Title' } },
        { type: 2, id: 2, tagName: 'input', attributes: { type: 'password', value: 'password-secret' } },
        { type: 2, id: 3, tagName: 'input', attributes: { type: 'hidden', value: 'hidden-secret' } },
        { type: 2, id: 4, tagName: 'button', attributes: { title: 'Useful action' } },
      ],
    },
  },
});

describe('sanitization boundary', () => {
  it('masks ordinary attributes by default', () => {
    const mask = createAttributeMasker({ element: () => undefined, textMasked: () => true });
    const json = JSON.stringify(mask(snapshot()));
    expect(json).not.toContain('My ordinary title');
    expect(json).not.toContain('password-secret');
    expect(json).not.toContain('hidden-secret');
    expect(json).not.toContain('Useful action');
  });
  it('opt-out preserves ordinary attributes, while secret snapshots/input events stay masked without a live mirror', () => {
    const mask = createAttributeMasker({ sanitize: false, element: () => undefined, textMasked: () => false });
    const json = JSON.stringify(mask(snapshot()));
    expect(json).toContain('My ordinary title');
    expect(json).toContain('Useful action');
    expect(json).not.toContain('password-secret');
    expect(json).not.toContain('hidden-secret');
    const input = (id: number) => mask({ type: 3, timestamp: 1, data: { source: 5, id, text: 'new-secret' } });
    expect(JSON.stringify(input(1))).toContain('new-secret');
    expect(JSON.stringify(input(2))).not.toContain('new-secret');
    expect(JSON.stringify(input(3))).not.toContain('new-secret');
    const changedType = mask({
      type: 3,
      timestamp: 2,
      data: { source: 0, attributes: [{ id: 1, attributes: { type: 'password', value: 'new-credential' } }] },
    });
    expect(JSON.stringify(changedType)).not.toContain('new-credential');
    expect(JSON.stringify(input(1))).not.toContain('new-secret');
    const mutation = mask({ type: 3, timestamp: 2, data: { source: 0, attributes: [{ id: 3, attributes: { value: 'rotated-secret' } }] } });
    expect(JSON.stringify(mutation)).not.toContain('rotated-secret');
  });
  it('cannot allow-list authentication headers and keeps URL credential protection', () => {
    expect(
      filterHeaders(
        [
          ['authorization', 'secret'],
          ['cookie', 'session'],
          ['x-api-key', 'key'],
          ['x-auth-token', 'token'],
          ['content-type', 'text/plain'],
        ],
        ['authorization', 'cookie', 'x-api-key', 'x-auth-token', 'content-type'],
      ),
    ).toEqual([{ name: 'content-type', value: 'text/plain' }]);
    const url = redactUrl('https://user:password@example.com/path?token=secret&ordinary=yes');
    expect(url).not.toContain('user:');
    expect(url).not.toContain('password');
    expect(url).not.toContain('token=secret');
    expect(url).toContain('ordinary=yes');
  });

  it('redacts URL credentials and sensitive query parameters in CSS without changing harmless URLs', () => {
    const css = `@import "https://cdn.test/quoted.css?token=import-quoted-secret"; background-image: url("https://user:pass@example.test/a.png?token=secret&theme=dark"), url(../local.png), url(../preview.css?token=relative-secret), url(#icon), url(#/route?token=hash-secret), url(data:image/png;base64,abc); @import url(https://cdn.test/base.css?api_key=private);`;
    const event: ReplayRrwebEvent = {
      type: 2,
      timestamp: 0,
      data: {
        node: {
          type: 0,
          childNodes: [
            { type: 2, id: 5, tagName: 'div', attributes: { style: css } },
            { type: 2, id: 6, tagName: 'style', attributes: { _cssText: css } },
          ],
        },
      },
    };
    const mask = createAttributeMasker({ element: () => undefined, textMasked: () => true });
    const once = redactEventUrls(mask(event));
    const twice = redactEventUrls(once);
    const json = JSON.stringify(twice);
    expect(json).not.toContain('user:pass');
    expect(json).not.toContain('token=secret');
    expect(json).not.toContain('api_key=private');
    expect(json).not.toContain('relative-secret');
    expect(json).not.toContain('hash-secret');
    expect(json).not.toContain('import-quoted-secret');
    expect(json).toContain('theme=dark');
    expect(json).toContain('../local.png');
    expect(json).toContain('../preview.css');
    expect(json).toContain('#icon');
    expect(json).toContain('data:image/png;base64,abc');
  });

  it('redacts CSS URLs separated from delimiters by comments, including style text mutations', () => {
    const css =
      '@import/*before*/"https://cdn.test/a.css?token=import-comment-secret"; .hero { background: url(/*start*/"https://user:pass@example.test/a?token=comment-secret&theme=dark"/*end*/); }';
    for (const event of [
      { type: 2, timestamp: 0, data: { node: { type: 0, childNodes: [{ type: 3, id: 3, textContent: css, isStyle: true }] } } },
      { type: 3, timestamp: 0, data: { source: 0, texts: [{ id: 3, value: css, text: css }] } },
      { type: 3, timestamp: 0, data: { source: 0, attributes: [{ id: 4, attributes: { style: css } }] } },
    ] satisfies ReplayRrwebEvent[]) {
      const once = redactEventUrls(event);
      const json = JSON.stringify(once);
      expect(json).not.toContain('user:pass');
      expect(json).not.toContain('comment-secret');
      expect(json).toContain('theme=dark');
      expect(json).toContain('/*end*/');
      expect(redactEventUrls(once)).toEqual(once);
    }
  });

  it('redacts credentials in an absolute URL nested in rrweb-resolved style text', () => {
    const event: ReplayRrwebEvent = {
      type: 3,
      timestamp: 0,
      data: {
        source: 0,
        texts: [{ id: 3, value: 'url(http://localhost:3000/%22https://user:pass@example.test/a?token=nested-secret&theme=dark)' }],
      },
    };
    const json = JSON.stringify(redactEventUrls(event));
    expect(json).not.toContain('user:pass');
    expect(json).not.toContain('nested-secret');
    expect(json).toContain('theme=dark');
  });

  it('handles escaped CSS function names and URL content inside style mutations', () => {
    const event: ReplayRrwebEvent = {
      type: 3,
      timestamp: 0,
      data: {
        source: 0,
        attributes: [{ id: 4, attributes: { style: String.raw`background: u\72l(https://user:pass@example.test/?token=private)` } }],
      },
    };
    const mask = createAttributeMasker({ element: () => undefined, textMasked: () => true });
    const json = JSON.stringify(redactEventUrls(mask(event)));
    expect(json).not.toContain('user:pass');
    expect(json).not.toContain('token=private');
    expect(json).toContain('background:');
  });

  it('redacts stylesheet rule cssText in incremental stylesheet mutations', () => {
    const event: ReplayRrwebEvent = {
      type: 3,
      timestamp: 0,
      data: { source: 8, adds: [{ cssText: '.banner { background: url(https://user:pass@example.test/?token=rule-secret) }' }] },
    };
    const json = JSON.stringify(redactEventUrls(event));
    expect(json).not.toContain('user:pass');
    expect(json).not.toContain('rule-secret');
    expect(json).toContain('.banner');
  });
});

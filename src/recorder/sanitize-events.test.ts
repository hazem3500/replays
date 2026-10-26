// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createAttributeMasker } from './sanitize-events.ts';
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
});

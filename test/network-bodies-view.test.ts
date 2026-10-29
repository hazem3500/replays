import { describe, expect, it } from 'vitest';

import { bodyState, bodyView, redactionParts } from '../src/client/viewer/network/body.ts';
import { curlCommand } from '../src/client/viewer/network/model.ts';

describe('network body views', () => {
  it('indents JSON that parses', () => {
    const view = bodyView('{"code":"SPRING10","valid":false}', 'application/json; charset=utf-8');
    expect(view).toEqual({ kind: 'json', text: '{\n  "code": "SPRING10",\n  "valid": false\n}', lines: 4 });
  });

  it('keeps a truncated JSON body as captured instead of failing to indent it', () => {
    expect(bodyView('{"items":[{"id":1},{"id"', 'application/json')).toMatchObject({ kind: 'text', text: '{"items":[{"id":1},{"id"' });
  });

  it('decodes a form body one field per line, so a redacted field shows its marker', () => {
    const view = bodyView('email=%5Bredacted%5D&coupon=SPRING+10', 'application/x-www-form-urlencoded');
    expect(view.text).toBe('email = [redacted]\ncoupon = SPRING 10');
  });

  it('reads a form body as a form even when the page labelled it JSON', () => {
    expect(bodyView('code=SPRING10&email=%5Bredacted%5D', 'application/json').text).toBe('code = SPRING10\nemail = [redacted]');
  });

  it('marks a URL-encoded redaction marker as redacted too', () => {
    expect(redactionParts('next=%5Bredacted%5D').filter((part) => part.redacted)).toEqual([{ text: '%5Bredacted%5D', redacted: true }]);
  });

  it('splits out redaction markers in any case', () => {
    expect(redactionParts('{"token": "[redacted]", "note": "[REDACTED] twice"}')).toEqual([
      { text: '{"token": "', redacted: false },
      { text: '[redacted]', redacted: true },
      { text: '", "note": "', redacted: false },
      { text: '[REDACTED]', redacted: true },
      { text: ' twice"}', redacted: false },
    ]);
  });
});

describe('network body states', () => {
  const bodies = { console: true, network: 'bodies', performance: true, video: false } as const;

  it('says not captured when the recording kept headers only, or predates capture profiles', () => {
    expect(bodyState(undefined, { ...bodies, network: 'headers' })).toEqual({ kind: 'not-captured' });
    expect(bodyState(undefined)).toEqual({ kind: 'not-captured' });
  });

  it('says there was no body when bodies were captured and this request had none', () => {
    expect(bodyState(undefined, bodies)).toEqual({ kind: 'empty' });
  });

  it('says why a body was left out', () => {
    expect(bodyState({ omitted: 'content-type' }, bodies)).toEqual({ kind: 'omitted', reason: 'content-type' });
  });

  it('shows the kept text with its truncation', () => {
    expect(bodyState({ text: 'ok', truncated: true, size: 90_000 }, bodies)).toMatchObject({ kind: 'shown', body: { truncated: true } });
  });
});

describe('cURL with bodies', () => {
  const entry = { method: 'POST', url: 'https://x.test/a', requestHeaders: [] };

  it('sends a body the capture kept whole', () => {
    expect(curlCommand({ ...entry, requestBody: { text: '{"a":1}' } })).toBe(
      "curl 'https://x.test/a' \\\n  -X POST \\\n  --data-raw '{\"a\":1}'",
    );
  });

  it('leaves out a truncated body rather than send what the page never did', () => {
    expect(curlCommand({ ...entry, requestBody: { text: '{"a":', truncated: true } })).not.toContain('--data-raw');
  });
});

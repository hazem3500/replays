import { describe, expect, it } from 'vitest';

import { captureSettings, capturedRecord, profileCapture } from '../src/capture/capture-settings.ts';
import { networkEntries, sanitizeReplayBundle } from '../src/capture/sanitize.ts';
import { captureBody, isSecretField } from '../src/shared/network-bodies.ts';
import { compileRedaction } from '../src/shared/redaction.ts';
import type { ReplayBundle, ReplayNetworkEntry } from '../src/shared/replay.ts';
import { replay } from './fixtures.ts';

const rules = compileRedaction({});
const json = (text: string, limits = {}) => captureBody({ text, mimeType: 'application/json; charset=utf-8' }, limits, { rules });
const SECRETS = [
  'hunter2',
  'sk_live_51H8',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl',
  '4242 4242 4242 4242',
  'ada@example.com',
];

function entry(extra: Partial<ReplayNetworkEntry>): ReplayNetworkEntry {
  return {
    id: 'request-1',
    at: 0,
    duration: 1,
    method: 'POST',
    url: 'https://example.com/api',
    status: 200,
    statusText: 'OK',
    requestHeaders: [],
    responseHeaders: [],
    ...extra,
  };
}

function bundleWith(network: ReplayNetworkEntry[]): ReplayBundle {
  return { ...replay('bodies'), network };
}

function har(text: string, mimeType: string, encoding?: string) {
  return {
    log: {
      entries: [
        {
          startedDateTime: new Date(1000).toISOString(),
          time: 5,
          request: {
            method: 'POST',
            url: 'https://example.com/login',
            headers: [{ name: 'Content-Type', value: 'application/json' }],
            postData: { mimeType: 'application/json', text: '{"email":"ada@example.com","password":"hunter2"}' },
          },
          response: {
            status: 200,
            statusText: 'OK',
            headers: [],
            content: { mimeType, text, ...(encoding ? { encoding } : {}), size: text.length },
          },
        },
      ],
    },
  };
}

describe('body redaction', () => {
  it('replaces secret fields at any depth in JSON', () => {
    const body = json('{"user":{"name":"Ada","password":"hunter2","settings":{"apiKey":"sk_live_51H8","csrf_token":"abc123"}}}');
    expect(body.text).not.toMatch(/hunter2|sk_live_51H8|abc123/);
    expect(body.text).toContain('"name":"Ada"');
  });

  it('finds secrets in JSON that was cut off mid-value', () => {
    const body = json(`{"padding":"${'x'.repeat(40)}","token":"sk_live_51H8_and_more"}`, { maxBytes: 70 });
    expect(body.truncated).toBe(true);
    expect(body.text).not.toContain('sk_live');
  });

  it('replaces credentials, JWTs, card numbers and email addresses in free text', () => {
    const text = `Authorization: Bearer sk_live_51H8abcdef, jwt ${SECRETS[2]}, card ${SECRETS[3]}, mail ${SECRETS[4]}`;
    const body = captureBody({ text, mimeType: 'text/plain' }, {}, { rules });
    for (const secret of ['sk_live_51H8abcdef', ...SECRETS.slice(2)]) expect(body.text).not.toContain(secret);
  });

  it('keeps millisecond timestamps and short numbers that only look like digits', () => {
    expect(json('{"at":1730000000000,"count":42}').text).toBe('{"at":1730000000000,"count":42}');
  });

  it('replaces secret parameters in form bodies', () => {
    const body = captureBody(
      { text: 'user=ada&pass_word=hunter2&otp=123456', mimeType: 'application/x-www-form-urlencoded' },
      {},
      { rules },
    );
    expect(body.text).toBe('user=ada&pass_word=%5Bredacted%5D&otp=%5Bredacted%5D');
  });

  it('applies the deployment JSON keys on top of the built-in ones', () => {
    const body = captureBody(
      { text: '{"ssn_hint":"1234"}', mimeType: 'application/json' },
      {},
      { rules: compileRedaction({ jsonKeys: ['ssn_hint'] }) },
    );
    expect(body.text).toBe('{"ssn_hint":"[redacted]"}');
  });

  it('treats camel, snake and kebab spellings of a secret name alike', () => {
    expect(['accessToken', 'refresh_token', 'X-Api-Key', 'cardNumber', 'CVV'].every(isSecretField)).toBe(true);
    expect(['monkey', 'tokenizer', 'description'].some(isSecretField)).toBe(false);
  });
});

describe('body limits', () => {
  it('leaves out binary bodies even when the type is allowed', () => {
    expect(captureBody({ text: 'AAEC', encoding: 'base64', mimeType: 'application/json', size: 3 }, {}, { rules })).toEqual({
      omitted: 'content-type',
      size: 3,
    });
  });

  it('leaves out content types outside the allowlist', () => {
    expect(captureBody({ text: 'GIF89a', mimeType: 'image/gif' }, {}, { rules })).toEqual({ omitted: 'content-type' });
  });

  it('honours a narrower profile allowlist', () => {
    expect(captureBody({ text: 'hello', mimeType: 'text/plain' }, { contentTypes: ['application/json'] }, { rules }).omitted).toBe(
      'content-type',
    );
  });

  it('cuts at maxBytes without splitting a character and marks the cut', () => {
    const body = captureBody({ text: 'ééééé', mimeType: 'text/plain' }, { maxBytes: 5 }, { rules });
    expect(body).toEqual({ text: 'éé', size: 10, truncated: true });
  });

  it('never keeps more than the default cap, whatever the profile asks', () => {
    const body = captureBody({ text: 'a'.repeat(70_000), mimeType: 'text/plain' }, { maxBytes: 1_000_000 }, { rules });
    expect(body.text).toHaveLength(64 * 1024);
  });
});

describe('bodies in the HAR conversion', () => {
  it('reads no body unless the capture asked for bodies', () => {
    const [plain] = networkEntries(har('{"ok":true}', 'application/json'), 0);
    expect(plain).not.toHaveProperty('requestBody');
    expect(plain).not.toHaveProperty('responseBody');
  });

  it('keeps redacted request and response bodies when asked', () => {
    const [kept] = networkEntries(har('{"session":"abc","ok":true}', 'application/json'), 0, undefined, {});
    expect(JSON.stringify(kept)).not.toMatch(/hunter2|ada@example\.com|"abc"/);
    expect(kept?.responseBody?.text).toBe('{"session":"[redacted]","ok":true}');
  });
});

describe('the server privacy pass over uploaded bodies', () => {
  it('redacts secrets a client left in a body', () => {
    const uploaded = bundleWith([
      entry({ mimeType: 'application/json', responseBody: { text: '{"password":"hunter2","note":"call ada@example.com"}' } }),
    ]);
    expect(JSON.stringify(sanitizeReplayBundle(uploaded).network)).not.toMatch(/hunter2|ada@example\.com/);
  });

  it('drops unknown body fields and body values that are not records', () => {
    const malformed = entry({});
    Object.assign(malformed, { requestBody: { text: 'ok', extra: 'leak' }, responseBody: 'raw' });
    const uploaded = bundleWith([malformed]);
    const [clean] = sanitizeReplayBundle(uploaded).network;
    expect(clean?.requestBody).toEqual({ text: 'ok' });
    expect(clean).not.toHaveProperty('responseBody');
  });

  it('redacts tokens in URLs inside a body', () => {
    const uploaded = bundleWith([
      entry({ mimeType: 'application/json', responseBody: { text: '{"next":"https://example.com/cb?code=s3cr3t"}' } }),
    ]);
    expect(JSON.stringify(sanitizeReplayBundle(uploaded).network)).not.toContain('s3cr3t');
  });

  it('changes nothing on a second pass', () => {
    const once = sanitizeReplayBundle(
      bundleWith([entry({ mimeType: 'application/json', responseBody: { text: '{"token":"x","card":"4242424242424242"}' } })]),
    );
    expect(sanitizeReplayBundle(once)).toEqual(once);
  });
});

describe('capture settings', () => {
  it('keeps headers only unless the profile or the flag asks for bodies', () => {
    expect(captureSettings(undefined, {}).network).toBe('headers');
    expect(captureSettings({ network: 'bodies' }, { network: 'headers' }).network).toBe('headers');
    expect(captureSettings({ network: 'headers' }, { network: 'bodies' })).toMatchObject({ network: 'bodies', bodies: {} });
  });

  it('stops a capture whose profile asks for a privacy setting the CLI cannot apply', () => {
    expect(() => captureSettings({ privacy: { blockMedia: true } }, {})).toThrow(/blockMedia/);
  });

  it('lets a config profile override the built-in one and a plugin one', () => {
    const capture = profileCapture('performance', {
      plugins: [{ id: 'performance', label: 'P', capture: { sampling: 'light' } }],
      config: [{ id: 'performance', label: 'P', capture: { network: 'off' } }],
    });
    expect(capture).toEqual({ network: 'off' });
  });

  it('records headers in meta.captured when the driver could not record bodies', () => {
    expect(capturedRecord({ network: 'bodies', performance: true }, false, false)).toEqual({
      console: true,
      network: 'headers',
      performance: true,
      video: false,
    });
  });
});

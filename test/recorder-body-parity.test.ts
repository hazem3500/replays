import { describe, expect, it } from 'vitest';

import { captureBody as recorderBody } from '../src/recorder/body-redaction.ts';
import { captureBody as sharedBody } from '../src/shared/network-bodies.ts';
import { compileRedaction } from '../src/shared/redaction.ts';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl';
const CASES: { name: string; text: string; mimeType: string; maxBytes?: number }[] = [
  {
    name: 'nested secret fields',
    text: '{"user":{"password":"hunter2","client_secret":{"a":1},"X-Api-Key":"k","name":"Ada"}}',
    mimeType: 'application/json',
  },
  { name: 'cut-off JSON', text: '{"items":[1,2],"refreshToken":"abc', mimeType: 'application/json' },
  { name: 'credentials in free text', text: `Authorization: Bearer abcdefghij token ${JWT}`, mimeType: 'text/plain' },
  {
    name: 'card numbers but not timestamps',
    text: '{"pan_hint":"4242-4242-4242-4242","at":1730000000000,"id":"4000056655665556"}',
    mimeType: 'application/vnd.api+json',
  },
  { name: 'e-mail addresses', text: '{"email":"ada@example.com","note":"cc grace@example.org"}', mimeType: 'application/json' },
  {
    name: 'form fields',
    text: 'user=ada&pass%77ord=x&csrf_token=t&msg=hi+ada@example.com&bad=%E0',
    mimeType: 'application/x-www-form-urlencoded',
  },
  { name: 'escaped keys', text: '{"pass\\u0077ord":"x","ok":"\\"quoted\\""}', mimeType: 'application/json' },
  { name: 'multi-byte text at the cap', text: `{"name":"${'é'.repeat(40)}"}`, mimeType: 'application/json', maxBytes: 33 },
  { name: 'a type outside the allowlist', text: 'GIF89a', mimeType: 'image/gif' },
];

describe('recorder body rules', () => {
  const rules = compileRedaction({});
  for (const { name, text, mimeType, maxBytes } of CASES) {
    const limits = maxBytes === undefined ? {} : { maxBytes };
    for (const maskEmails of [true, false]) {
      it(`match the shared rules for ${name}${maskEmails ? '' : ' with e-mails visible'}`, () => {
        expect(recorderBody({ text, mimeType }, limits, maskEmails)).toEqual(sharedBody({ text, mimeType }, limits, { rules, maskEmails }));
      });
    }
  }
});

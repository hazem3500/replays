import { describe, expect, it } from 'vitest';
import { assertReplayContext } from '../shared/context.ts';
import { recorderContext } from './host-context.ts';

describe('recorderContext', () => {
  it('produces a validator-compatible portable snapshot without retaining the hosts mutable objects', () => {
    const input = {
      app: { name: 'Example', environment: 'staging', origin: 'https://example.test', version: '1.2.3', commit: 'abcdef123' },
      fields: { route: '/tasks', enabled: true },
    };
    const context = recorderContext(input, '2026-11-08T00:00:00.000Z');
    expect(() => assertReplayContext(context)).not.toThrow();
    input.fields.route = '/other';
    expect(context.fields?.route).toBe('/tasks');
  });

  it.each(['authorization', 'apiToken', 'password', 'constructor', 'prototype'])('rejects unsafe host field %s', (key) => {
    expect(() => recorderContext({ fields: { [key]: 'secret' } }, '2026-11-08T00:00:00.000Z')).toThrow(
      'Unsafe recorder context field',
    );
  });

  it('rejects origins that carry credentials or a route', () => {
    expect(() => recorderContext({ app: { origin: 'https://name:password@example.test/path' } }, '2026-11-08T00:00:00.000Z')).toThrow(
      'Invalid recorder context origin',
    );
  });
});

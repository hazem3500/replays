import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';

import type { AuthAdapter } from '../auth/types.ts';
import { runnerOf, type TestRunner } from './runner.ts';

export interface FakeRequestInit {
  method?: string;
  /** Path and query, e.g. `/api/replays`. Default `/`. */
  url?: string;
  /** Header names are lowercased, as Node does. */
  headers?: Record<string, string | string[] | undefined>;
  /** The peer address (`request.socket.remoteAddress`). Default `127.0.0.1`. */
  remoteAddress?: string;
}

/** An `IncomingMessage` stand-in with what an auth adapter reads: method, url, headers and the peer address. */
export function fakeRequest(init: FakeRequestInit = {}): IncomingMessage {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(init.headers ?? {})) if (value !== undefined) headers[name.toLowerCase()] = value;
  return {
    method: init.method ?? 'GET',
    url: init.url ?? '/',
    headers,
    socket: { remoteAddress: init.remoteAddress ?? '127.0.0.1' },
  } as unknown as IncomingMessage;
}

export interface AuthAdapterContract {
  /** Builds the adapter; called once per test. */
  create(): AuthAdapter | Promise<AuthAdapter>;
  /** Requests the adapter must accept, with the identity `id` it should produce (optional). At least one. */
  accepts: ReadonlyArray<{ title: string; request: FakeRequestInit | (() => FakeRequestInit | Promise<FakeRequestInit>); id?: string }>;
  /** Requests it must refuse (`authenticate` returns undefined). */
  refuses: ReadonlyArray<{ title: string; request: FakeRequestInit | (() => FakeRequestInit | Promise<FakeRequestInit>) }>;
}

const ID = /^[a-z][a-z0-9-]{0,39}$/;

async function requestOf(request: AuthAdapterContract['accepts'][number]['request']) {
  return fakeRequest(typeof request === 'function' ? await request() : request);
}

/**
 * The contract an `AuthAdapter` passes, as a test suite (any runner: pass its `describe` and `it`). Checks the adapter's shape
 * (`name`, `routes`), that each accepted request yields a well-formed `Identity` (a non-empty `id`, string fields, an https
 * `avatarUrl`), that each refused one yields undefined, and that hostile input (oversized, repeated or garbage headers) is
 * refused or answered, never thrown.
 *
 *   describeAuthAdapter('acme', {
 *     create: () => acmeAuth({ secret }),
 *     accepts: [{ title: 'a signed header', request: { headers: { 'x-acme-user': sign('ada@example.com') } }, id: 'ada@example.com' }],
 *     refuses: [{ title: 'no header', request: {} }],
 *   }, { describe, it });
 */
export function describeAuthAdapter(name: string, contract: AuthAdapterContract, runner?: TestRunner) {
  const { describe, it } = runnerOf(runner, 'describeAuthAdapter');
  describe(`${name} auth adapter (AuthAdapter contract)`, () => {
    it('has a name, and well-formed routes', async () => {
      const adapter = await contract.create();
      assert.equal(typeof adapter.name, 'string');
      assert.match(adapter.name, ID);
      assert.equal(typeof adapter.authenticate, 'function');
      for (const route of adapter.routes ?? []) assert.match(route, /^\/[A-Za-z0-9._~/-]*$/, `route ${route} is a canonical path`);
      if (adapter.handle !== undefined) assert.equal(typeof adapter.handle, 'function');
      if (adapter.loginUrl !== undefined) assert.equal(typeof adapter.loginUrl, 'function');
      assert.ok(contract.accepts.length > 0, 'the contract lists at least one accepted request');
    });

    for (const accepted of contract.accepts)
      it(`accepts ${accepted.title}`, async () => {
        const adapter = await contract.create();
        const identity = await adapter.authenticate(await requestOf(accepted.request));
        assert.ok(identity, 'authenticate returns an identity');
        assert.equal(typeof identity.id, 'string');
        assert.ok(identity.id.length > 0, 'the identity has a non-empty id');
        if (accepted.id !== undefined) assert.equal(identity.id, accepted.id);
        for (const field of ['email', 'name', 'avatarUrl'] as const)
          if (identity[field] !== undefined) assert.equal(typeof identity[field], 'string', `${field} is a string`);
        if (identity.avatarUrl !== undefined) assert.match(identity.avatarUrl, /^https:\/\//, 'avatarUrl is an https URL');
      });

    for (const refused of contract.refuses)
      it(`refuses ${refused.title}`, async () => {
        const adapter = await contract.create();
        assert.equal(await adapter.authenticate(await requestOf(refused.request)), undefined);
      });

    it('never throws on hostile input', async () => {
      const adapter = await contract.create();
      const junk = ['', ' ', 'a'.repeat(16_384), 'Bearer', 'Bearer a.b.c', 'Bearer ...', '\u0000', '{"alg":"none"}'];
      const base = await requestOf(contract.accepts[0]!.request);
      for (const value of junk) {
        const headers: Record<string, string> = {};
        // The accepted request's headers with garbage values, once alone and once repeated (Node joins repeats with ", ").
        for (const header of [...Object.keys(base.headers), 'authorization', 'cookie']) headers[header] = value;
        await adapter.authenticate(fakeRequest({ headers }));
        for (const header of Object.keys(headers)) headers[header] = `${value}, ${value}`;
        await adapter.authenticate(fakeRequest({ headers }));
      }
    });
  });
}

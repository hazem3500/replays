/**
 * `@hazem3500/replays/server/testing`: the contract suites the built-in adapters pass, for testing your own.
 *
 *   import { describe, it } from 'vitest';   // or 'node:test'; assertions are node:assert, so any runner works
 *   import { describeObjectStorage } from '@hazem3500/replays/server/testing';
 *   describeObjectStorage('acme', () => new AcmeStorage(freshBucket()), { describe, it });
 *
 * See docs/extension-api.md#testing-a-plugin.
 */
export { describeObjectStorage, type ObjectStorageFactory } from './storage.ts';
export { describeAuthAdapter, fakeRequest, type AuthAdapterContract, type FakeRequestInit } from './auth.ts';
export type { TestRunner } from './runner.ts';

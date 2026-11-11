import { describe, expect, it } from 'vitest';

import { replay } from '../fixtures.ts';
import { capture, contractApps, jsonInit } from './harness.ts';

const boot = contractApps();

const unknownAPIPathAnswer = {
  body: {
    error: 'not found',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 404,
};

const unsupportedMethodAnswer = {
  body: {
    error: 'not found',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 404,
};

const viewerPageAnswer = {
  body: {
    html: true,
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/html; charset=utf-8',
    etag: 'W/"<etag>"',
    vary: 'Accept-Encoding',
  },
  status: 200,
};

const nonPageMissAnswer = {
  body: 'not found',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 404,
};

const receiptUnderBaseAnswer = {
  body: {
    id: 'contract-b',
    url: '/replays/r/contract-b',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 201,
};

const listUnderBaseAnswer = {
  body: [
    {
      capturedAt: '2026-10-06T00:00:00.000Z',
      consoleErrors: 0,
      duration: 1000,
      expiresAt: '<now+30d>',
      failedRequests: 0,
      host: 'example.com',
      id: 'contract-b',
      source: 'agent',
      steps: 1,
      summaryVersion: 11,
      timeline: {
        errors: [],
        steps: [0],
      },
      title: 'Test replay',
      url: 'https://example.com/',
      viewport: {
        height: 900,
        width: 1440,
      },
    },
  ],
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
    etag: 'W/"<etag>"',
    vary: 'Accept-Encoding',
  },
  status: 200,
};

const indexPageUnderBaseAnswer = {
  body: {
    html: true,
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/html; charset=utf-8',
    etag: 'W/"<etag>"',
    vary: 'Accept-Encoding',
  },
  status: 200,
};

const receiptOnRootHostAnswer = {
  body: {
    id: 'contract-h',
    url: '/r/contract-h',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
    vary: 'Host, X-Forwarded-Host',
  },
  status: 201,
};

const listOnDefaultHostAnswer = {
  body: [
    {
      capturedAt: '2026-10-06T00:00:00.000Z',
      consoleErrors: 0,
      duration: 1000,
      expiresAt: '<now+30d>',
      failedRequests: 0,
      host: 'example.com',
      id: 'contract-h',
      source: 'agent',
      steps: 1,
      summaryVersion: 11,
      timeline: {
        errors: [],
        steps: [0],
      },
      title: 'Test replay',
      url: 'https://example.com/',
      viewport: {
        height: 900,
        width: 1440,
      },
    },
  ],
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
    etag: 'W/"<etag>"',
    vary: 'Accept-Encoding, Host, X-Forwarded-Host',
  },
  status: 200,
};

describe('HTTP contract: unknown paths and pages', () => {
  it('answers an unknown API path with a JSON 404', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch('/api/nope'))).toEqual(unknownAPIPathAnswer);
  });
  it('answers an unsupported method on an API path with a JSON 404', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch('/api/replays', { method: 'DELETE' }))).toEqual(unsupportedMethodAnswer);
  });
  it('serves the viewer page for a page load', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch('/r/test-replay', { headers: { accept: 'text/html' } }))).toEqual(viewerPageAnswer);
  });
  it('answers a missing non-page file with a text 404', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch('/no-such-file.txt'))).toEqual(nonPageMissAnswer);
  });
});

describe('HTTP contract: base paths and hosts', () => {
  it('issues receipts under the base path', async () => {
    const { client } = await boot({ basePath: '/replays' });
    expect(await capture(await client.fetch('/replays/api/replays', jsonInit('POST', replay('contract-b'))))).toEqual(
      receiptUnderBaseAnswer,
    );
  });
  it('lists replays under the base path', async () => {
    const { client } = await boot({ basePath: '/replays' });
    await client.fetch('/replays/api/replays', jsonInit('POST', replay('contract-b')));
    expect(await capture(await client.fetch('/replays/api/replays'))).toEqual(listUnderBaseAnswer);
  });
  it('serves the index page under the base path', async () => {
    const { client } = await boot({ basePath: '/replays' });
    expect(await capture(await client.fetch('/replays/', { headers: { accept: 'text/html' } }))).toEqual(indexPageUnderBaseAnswer);
  });
  it('issues receipts at the root of a host with its own base', async () => {
    const { client } = await boot({ basePath: '/replays', hosts: { 'replays.example.com': { basePath: '' } }, trustForwardedHost: true });
    expect(
      await capture(
        await client.fetch('/api/replays', jsonInit('POST', replay('contract-h'), { 'x-forwarded-host': 'replays.example.com' })),
      ),
    ).toEqual(receiptOnRootHostAnswer);
  });
  it('lists replays under the default base on other hosts', async () => {
    const { client } = await boot({ basePath: '/replays', hosts: { 'replays.example.com': { basePath: '' } }, trustForwardedHost: true });
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-h'), { 'x-forwarded-host': 'replays.example.com' }));
    expect(await capture(await client.fetch('/replays/api/replays'))).toEqual(listOnDefaultHostAnswer);
  });
});

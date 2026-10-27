import { describe, expect, it } from 'vitest';

import { capture, contractApps, jsonInit } from './harness.ts';

const boot = contractApps();
const suite = {
  version: 1,
  id: 'contract-suite',
  title: 'Checkout review',
  createdAt: '2026-10-10T12:00:00.000Z',
  subject: { provider: 'github', ref: 'example-org/shop-demo#42' },
};
const run = { id: 'attempt-1', sequence: 1, label: 'Desktop checkout', status: 'running', startedAt: '2026-10-10T12:01:00.000Z' };

const registerSuiteAnswer = {
  body: {
    createdAt: '<now-17d>',
    id: 'contract-suite',
    runs: [],
    subject: {
      label: 'example-org/shop-demo#42',
      provider: 'github',
      ref: 'example-org/shop-demo#42',
      url: 'https://github.com/example-org/shop-demo/issues/42',
    },
    title: 'Checkout review',
    version: 1,
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 200,
};

const registerRunAnswer = {
  body: {
    createdAt: '<now-17d>',
    id: 'contract-suite',
    runs: [
      {
        id: 'attempt-1',
        label: 'Desktop checkout',
        sequence: 1,
        startedAt: '<now-17d>',
        status: 'running',
      },
    ],
    subject: {
      label: 'example-org/shop-demo#42',
      provider: 'github',
      ref: 'example-org/shop-demo#42',
      url: 'https://github.com/example-org/shop-demo/issues/42',
    },
    title: 'Checkout review',
    version: 1,
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 200,
};

const runConflictAnswer = {
  body: 'run attempt-1 sequence cannot change',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 409,
};

const suiteAnswer = {
  body: {
    createdAt: '<now-17d>',
    id: 'contract-suite',
    runs: [
      {
        id: 'attempt-1',
        label: 'Desktop checkout',
        sequence: 1,
        startedAt: '<now-17d>',
        status: 'running',
      },
    ],
    subject: {
      label: 'example-org/shop-demo#42',
      provider: 'github',
      ref: 'example-org/shop-demo#42',
      url: 'https://github.com/example-org/shop-demo/issues/42',
    },
    title: 'Checkout review',
    version: 1,
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
    etag: 'W/"<etag>"',
    vary: 'Accept-Encoding',
  },
  status: 200,
};

const suiteExpandedAnswer = {
  body: {
    createdAt: '<now-17d>',
    id: 'contract-suite',
    runDetails: [
      {
        id: 'attempt-1',
        label: 'Desktop checkout',
        sequence: 1,
        startedAt: '<now-17d>',
        status: 'running',
      },
    ],
    runs: [
      {
        id: 'attempt-1',
        label: 'Desktop checkout',
        sequence: 1,
        startedAt: '<now-17d>',
        status: 'running',
      },
    ],
    subject: {
      label: 'example-org/shop-demo#42',
      provider: 'github',
      ref: 'example-org/shop-demo#42',
      url: 'https://github.com/example-org/shop-demo/issues/42',
    },
    title: 'Checkout review',
    version: 1,
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
    etag: 'W/"<etag>"',
    vary: 'Accept-Encoding',
  },
  status: 200,
};

const suiteListAnswer = {
  body: [
    {
      createdAt: '<now-17d>',
      duration: 0,
      expiresAt: '<now+30d>',
      failed: 0,
      id: 'contract-suite',
      missingRecordings: 1,
      partial: 0,
      running: 1,
      runs: 1,
      subject: {
        label: 'example-org/shop-demo#42',
        provider: 'github',
        url: 'https://github.com/example-org/shop-demo/issues/42',
      },
      title: 'Checkout review',
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

const suiteIndexAnswer = {
  body: [
    {
      createdAt: '<now-17d>',
      duration: 0,
      expiresAt: '<now+30d>',
      failed: 0,
      id: 'contract-suite',
      missingRecordings: 1,
      partial: 0,
      runDetails: [
        {
          id: 'attempt-1',
          label: 'Desktop checkout',
          sequence: 1,
          startedAt: '<now-17d>',
          status: 'running',
        },
      ],
      running: 1,
      runs: 1,
      subject: {
        label: 'example-org/shop-demo#42',
        provider: 'github',
        url: 'https://github.com/example-org/shop-demo/issues/42',
      },
      title: 'Checkout review',
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

const suite404Answer = {
  body: {
    error: 'suite not found',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
    vary: 'Accept-Encoding',
  },
  status: 404,
};

const suiteIdMismatchAnswer = {
  body: 'suite ID does not match path',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 400,
};

describe('HTTP contract: review suites', () => {
  it('registers a suite', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch(`/api/suites/${suite.id}`, jsonInit('PUT', suite)))).toEqual(registerSuiteAnswer);
  });
  it('registers a run of a suite', async () => {
    const { client } = await boot();
    await client.fetch(`/api/suites/${suite.id}`, jsonInit('PUT', suite));
    expect(await capture(await client.fetch(`/api/suites/${suite.id}/runs/${run.id}`, jsonInit('PUT', run)))).toEqual(registerRunAnswer);
  });
  it('refuses a run whose sequence changes', async () => {
    const { client } = await boot();
    await client.fetch(`/api/suites/${suite.id}`, jsonInit('PUT', suite));
    await client.fetch(`/api/suites/${suite.id}/runs/${run.id}`, jsonInit('PUT', run));
    expect(await capture(await client.fetch(`/api/suites/${suite.id}/runs/${run.id}`, jsonInit('PUT', { ...run, sequence: 3 })))).toEqual(
      runConflictAnswer,
    );
  });
  it('serves a suite with its runs', async () => {
    const { client } = await boot();
    await client.fetch(`/api/suites/${suite.id}`, jsonInit('PUT', suite));
    await client.fetch(`/api/suites/${suite.id}/runs/${run.id}`, jsonInit('PUT', run));
    expect(await capture(await client.fetch(`/api/suites/${suite.id}`))).toEqual(suiteAnswer);
  });
  it("expands a suite's runs into replay summaries", async () => {
    const { client } = await boot();
    await client.fetch(`/api/suites/${suite.id}`, jsonInit('PUT', suite));
    await client.fetch(`/api/suites/${suite.id}/runs/${run.id}`, jsonInit('PUT', run));
    expect(await capture(await client.fetch(`/api/suites/${suite.id}?expand=runs`))).toEqual(suiteExpandedAnswer);
  });
  it('lists suites', async () => {
    const { client } = await boot();
    await client.fetch(`/api/suites/${suite.id}`, jsonInit('PUT', suite));
    await client.fetch(`/api/suites/${suite.id}/runs/${run.id}`, jsonInit('PUT', run));
    expect(await capture(await client.fetch('/api/suites'))).toEqual(suiteListAnswer);
  });
  it('lists the suite index with runs', async () => {
    const { client } = await boot();
    await client.fetch(`/api/suites/${suite.id}`, jsonInit('PUT', suite));
    await client.fetch(`/api/suites/${suite.id}/runs/${run.id}`, jsonInit('PUT', run));
    expect(await capture(await client.fetch('/api/suites?expand=runs'))).toEqual(suiteIndexAnswer);
  });
  it('answers a missing suite with a JSON 404', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch('/api/suites/missing-suite'))).toEqual(suite404Answer);
  });
  it('refuses a suite whose id differs from its path', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch(`/api/suites/${suite.id}`, jsonInit('PUT', { ...suite, id: 'other' })))).toEqual(
      suiteIdMismatchAnswer,
    );
  });
});

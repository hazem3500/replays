import { describe, expect, it } from 'vitest';

import { replay } from '../fixtures.ts';
import { capture, contractApps, jsonInit } from './harness.ts';

const boot = contractApps();

const emptyListAnswer = {
  body: [],
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
    etag: 'W/"<etag>"',
    vary: 'Accept-Encoding',
  },
  status: 200,
};

const status201ReceiptAnswer = {
  body: {
    id: 'contract-a',
    url: '/r/contract-a',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 201,
};

const status409DuplicateIdAnswer = {
  body: 'replay contract-a already exists',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 409,
};

const listAnswer = {
  body: [
    {
      capturedAt: '2026-10-06T00:00:00.000Z',
      consoleErrors: 0,
      duration: 1000,
      expiresAt: '<now+30d>',
      failedRequests: 0,
      host: 'example.com',
      id: 'contract-a',
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

const list304Answer = {
  body: '',
  headers: {
    'cache-control': 'private, no-cache',
    etag: 'W/"<etag>"',
    vary: 'Accept-Encoding',
  },
  status: 304,
};

const listBrAnswer = {
  body: [
    {
      capturedAt: '2026-10-06T00:00:00.000Z',
      consoleErrors: 0,
      duration: 1000,
      expiresAt: '<now+30d>',
      failedRequests: 0,
      host: 'example.com',
      id: 'contract-a',
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

const listFilteredAnswer = {
  body: [],
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
    etag: 'W/"<etag>"',
    vary: 'Accept-Encoding',
  },
  status: 200,
};

const bundleAnswer = {
  body: {
    console: [],
    events: [
      {
        timestamp: 1000,
        type: 4,
      },
      {
        timestamp: 2000,
        type: 2,
      },
    ],
    meta: {
      capturedAt: '2026-10-06T00:00:00.000Z',
      duration: 1000,
      eventCount: 2,
      id: 'contract-a',
      title: 'Test replay',
      url: 'https://example.com/',
      version: 1,
      viewport: {
        height: 900,
        width: 1440,
      },
    },
    network: [],
    steps: [
      {
        at: 0,
        kind: 'open',
        label: 'Open example.com',
        url: 'https://example.com/',
      },
    ],
  },
  headers: {
    'cache-control': 'private, max-age=86400, immutable',
    'content-type': 'application/json; charset=utf-8',
    etag: 'W/"<etag>"',
    vary: 'Accept-Encoding',
  },
  status: 200,
};

const bundle304Answer = {
  body: '',
  headers: {
    'cache-control': 'private, max-age=86400, immutable',
    'content-type': 'application/json; charset=utf-8',
    etag: 'W/"<etag>"',
    vary: 'Accept-Encoding',
  },
  status: 304,
};

const bundle404Answer = {
  body: 'replay not found',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 404,
};

const status400BadJSONAnswer = {
  body: 'body is not valid JSON',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 400,
};

const status400InvalidBundleAnswer = {
  body: "replay must have required property 'events'",
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 400,
};

const status413TooLargeAnswer = {
  body: 'upload is larger than 25 MB',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 413,
};

const import201Answer = {
  body: {
    id: 'contract-import',
    url: '/r/contract-import',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 201,
};

const import400ProfileAnswer = {
  body: 'profile is set, but this server defines no profiles (remove it, or declare profiles in the config)',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 400,
};

describe('HTTP contract: the replay list', () => {
  it('lists nothing before the first upload', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch('/api/replays'))).toEqual(emptyListAnswer);
  });
  it('answers an upload with a 201 receipt', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch('/api/replays', jsonInit('POST', replay('contract-a'))))).toEqual(status201ReceiptAnswer);
  });
  it('refuses a second upload with the same id', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-a')));
    expect(await capture(await client.fetch('/api/replays', jsonInit('POST', replay('contract-a'))))).toEqual(status409DuplicateIdAnswer);
  });
  it('lists an uploaded replay with its summary', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-a')));
    expect(await capture(await client.fetch('/api/replays'))).toEqual(listAnswer);
  });
  it('revalidates the list with a 304', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-a')));
    const etag = (await client.fetch('/api/replays')).headers.get('etag') ?? '';
    expect(await capture(await client.fetch('/api/replays', { headers: { 'if-none-match': etag } }))).toEqual(list304Answer);
  });
  it('leaves a small list uncompressed even when br is accepted', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-a')));
    expect(await capture(await client.fetch('/api/replays', { headers: { 'accept-encoding': 'br' } }))).toEqual(listBrAnswer);
  });
  it('filters the list by query', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-a')));
    expect(await capture(await client.fetch('/api/replays?q=nothing-matches'))).toEqual(listFilteredAnswer);
  });
});

describe('HTTP contract: a replay bundle', () => {
  it('serves an uploaded bundle as immutable', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-a')));
    expect(await capture(await client.fetch('/api/replays/contract-a'))).toEqual(bundleAnswer);
  });
  it('revalidates a bundle with a 304', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-a')));
    const etag = (await client.fetch('/api/replays/contract-a')).headers.get('etag') ?? '';
    expect(await capture(await client.fetch('/api/replays/contract-a', { headers: { 'if-none-match': etag } }))).toEqual(bundle304Answer);
  });
  it('answers a missing bundle with a text 404', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch('/api/replays/missing-replay'))).toEqual(bundle404Answer);
  });
});

describe('HTTP contract: upload validation', () => {
  it('refuses a body that is not JSON', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch('/api/replays', { method: 'POST', body: '{not json' }))).toEqual(status400BadJSONAnswer);
  });
  it('refuses a bundle that fails validation', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch('/api/replays', jsonInit('POST', { meta: {} })))).toEqual(status400InvalidBundleAnswer);
  });
  it('refuses an upload over 25 MB', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch('/api/replays', { method: 'POST', body: `"${'x'.repeat(25 * 1024 * 1024 + 16)}"` }))).toEqual(
      status413TooLargeAnswer,
    );
  });
});

describe('HTTP contract: rrweb import', () => {
  it('imports a plain rrweb recording', async () => {
    const { client } = await boot();
    expect(
      await capture(
        await client.fetch(
          `/api/replays/import?title=Imported&url=${encodeURIComponent('https://example.com/')}&id=contract-import&tag=imported`,
          jsonInit('POST', replay('src').events),
        ),
      ),
    ).toEqual(import201Answer);
  });
  it('refuses an import with a profile the deployment lacks', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch('/api/replays/import?profile=nope', jsonInit('POST', replay('src').events)))).toEqual(
      import400ProfileAnswer,
    );
  });
});

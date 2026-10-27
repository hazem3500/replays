import { describe, expect, it } from 'vitest';

import { replay } from '../fixtures.ts';
import { capture, contractApps, jsonInit } from './harness.ts';

const boot = contractApps();
const video = { method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]) };

const videoBeforeReplayAnswer = {
  body: 'upload the replay before its video',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 404,
};

const video201Answer = {
  body: {
    id: 'contract-v',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 201,
};

const videoGETAnswer = {
  body: {
    bytes: 8,
    sha256: 'd9f1cb99ee212918',
  },
  headers: {
    'cache-control': 'private, max-age=3600',
    'content-disposition': 'attachment; filename="contract-v.mp4"',
    'content-type': 'video/mp4',
  },
  status: 200,
};

const videoHEADAnswer = {
  body: '',
  headers: {
    'cache-control': 'private, max-age=3600',
    'content-disposition': 'attachment; filename="contract-v.mp4"',
    'content-type': 'video/mp4',
  },
  status: 200,
};

const video404Answer = {
  body: 'video not found',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 404,
};

const keepGETAnswer = {
  body: {
    expiresAt: '<now+30d>',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 200,
};

const keepPUTAnswer = {
  body: {
    expiresAt: null,
    kept: {
      at: '<now>',
      by: 'anonymous',
    },
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 200,
};

const keepDELETEAnswer = {
  body: {
    expiresAt: '<now+30d>',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 200,
};

const keep405Answer = {
  body: {
    error: 'method not allowed',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 405,
};

const keep404Answer = {
  body: {
    error: 'replay not found',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 404,
};

const getPosterAnswer = {
  body: {
    error: 'posters unavailable',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 503,
};

const getOpenAnswer = {
  body: {
    error: 'opening stills unavailable',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 503,
};

const getPreviewAnswer = {
  body: {
    error: 'previews unavailable',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 503,
};

const getRenderAnswer = {
  body: {
    status: 'unavailable',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 200,
};

const getRenderFileAnswer = {
  body: {
    error: 'render unavailable',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 503,
};

const postPosterAnswer = {
  body: {
    error: 'method not allowed',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 405,
};

describe('HTTP contract: replay videos', () => {
  it('refuses a video before its replay exists', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch('/api/replays/contract-v/video', video))).toEqual(videoBeforeReplayAnswer);
  });
  it('stores a video for an uploaded replay', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-v')));
    expect(await capture(await client.fetch('/api/replays/contract-v/video', video))).toEqual(video201Answer);
  });
  it('serves a stored video as a download', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-v')));
    await client.fetch('/api/replays/contract-v/video', video);
    expect(await capture(await client.fetch('/api/replays/contract-v/video'))).toEqual(videoGETAnswer);
  });
  it('answers HEAD for a stored video', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-v')));
    await client.fetch('/api/replays/contract-v/video', video);
    expect(await capture(await client.fetch('/api/replays/contract-v/video', { method: 'HEAD' }))).toEqual(videoHEADAnswer);
  });
  it('answers a missing video with a 404', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch('/api/replays/contract-x/video'))).toEqual(video404Answer);
  });
});

describe('HTTP contract: keeping a replay', () => {
  it("reports a replay's retention", async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-k')));
    expect(await capture(await client.fetch('/api/replays/contract-k/keep'))).toEqual(keepGETAnswer);
  });
  it('keeps a replay', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-k')));
    expect(await capture(await client.fetch('/api/replays/contract-k/keep', { method: 'PUT' }))).toEqual(keepPUTAnswer);
  });
  it('releases a kept replay', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-k')));
    await client.fetch('/api/replays/contract-k/keep', { method: 'PUT' });
    expect(await capture(await client.fetch('/api/replays/contract-k/keep', { method: 'DELETE' }))).toEqual(keepDELETEAnswer);
  });
  it('refuses other methods on keep', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-k')));
    expect(await capture(await client.fetch('/api/replays/contract-k/keep', { method: 'POST' }))).toEqual(keep405Answer);
  });
  it('answers keep for a missing replay with a 404', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch('/api/replays/contract-z/keep'))).toEqual(keep404Answer);
  });
});

describe('HTTP contract: media without rendering', () => {
  it('answers poster when rendering is off', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-m')));
    expect(await capture(await client.fetch('/api/replays/contract-m/poster'))).toEqual(getPosterAnswer);
  });
  it('answers open when rendering is off', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-m')));
    expect(await capture(await client.fetch('/api/replays/contract-m/open'))).toEqual(getOpenAnswer);
  });
  it('answers preview when rendering is off', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-m')));
    expect(await capture(await client.fetch('/api/replays/contract-m/preview'))).toEqual(getPreviewAnswer);
  });
  it('answers render when rendering is off', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-m')));
    expect(await capture(await client.fetch('/api/replays/contract-m/render'))).toEqual(getRenderAnswer);
  });
  it('answers render/file when rendering is off', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-m')));
    expect(await capture(await client.fetch('/api/replays/contract-m/render/file'))).toEqual(getRenderFileAnswer);
  });
  it('refuses POST on a poster', async () => {
    const { client } = await boot();
    await client.fetch('/api/replays', jsonInit('POST', replay('contract-m')));
    expect(await capture(await client.fetch('/api/replays/contract-m/poster', { method: 'POST' }))).toEqual(postPosterAnswer);
  });
});

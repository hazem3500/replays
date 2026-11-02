import { describe, expect, it } from 'vitest';

import type { AuthAdapter } from '../../src/server/auth/types.ts';
import { ViewCatalog } from '../../src/server/views.ts';
import { replay } from '../fixtures.ts';
import { capture, contractApps, jsonInit } from './harness.ts';

const boot = contractApps();
const closed: AuthAdapter = { name: 'closed', authenticate: (): undefined => {} };
const withLogin: AuthAdapter = { ...closed, loginUrl: () => '/auth/login' };
const uploadOnly: AuthAdapter = { name: 'upload-token', authenticate: () => ({ id: 'ci-bot', authScopes: ['replays:upload'] }) };

const getNotAPageLoadAnswer = {
  body: 'ok',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 200,
};

const getHealthzAnswer = {
  body: 'ok',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 200,
};

const status401WithLoginUrlAnswer = {
  body: 'sign in required',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 401,
};

const status403ApiReplaysAnswer = {
  body: 'forbidden',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 403,
};

const status403ApiReplaysTestReplayAnswer = {
  body: 'forbidden',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 403,
};

const status403ApiSuitesAnswer = {
  body: 'forbidden',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 403,
};

const status403ApiMeAnswer = {
  body: 'forbidden',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 403,
};

const status403ApiConfigAnswer = {
  body: 'forbidden',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 403,
};

const status403PageAnswer = {
  body: 'forbidden',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 403,
};

const capabilitiesAnswer = {
  body: {
    auth: 'upload-token',
    deviceFlow: null,
  },
  headers: {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 200,
};

const statusUploadScopeAnswer = {
  body: {
    identity: {
      id: 'ci-bot',
    },
    scopes: ['replays:upload'],
  },
  headers: {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 200,
};

const uploadTokenReadingTheListAnswer = {
  body: 'upload token cannot access this route',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 403,
};

const uploadTokenUploadAnswer = {
  body: {
    id: 'scoped-upload',
    url: '/r/scoped-upload',
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 201,
};

const crossSitePOSTAnswer = {
  body: 'cross-site request',
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'text/plain; charset=utf-8',
  },
  status: 403,
};

const getApiConfigAnswer = {
  body: {
    auth: 'none',
    beta: {
      editor: false,
      cursorCustomization: false,
      malleable: false,
    },
    comments: false,
    core: '<version>',
    editing: {
      enabled: false,
    },
    name: 'replays',
    plugins: [],
    profiles: [],
    purposes: [],
    sourceProviders: ['github', 'gitlab', 'url'],
    views: new ViewCatalog().list,
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 200,
};

const getApiMeAnswer = {
  body: {
    id: 'anonymous',
    session: {
      signedIn: false,
    },
  },
  headers: {
    'cache-control': 'private, no-cache',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 200,
};

const getApiCliAuthStatusAnswer = {
  body: {
    identity: {
      id: 'anonymous',
    },
    scopes: [],
  },
  headers: {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  },
  status: 200,
};

describe('HTTP contract: health checks', () => {
  it('answers GET / that is not a page load without an identity', async () => {
    const { client } = await boot({ auth: closed });
    expect(await capture(await client.fetch('/'))).toEqual(getNotAPageLoadAnswer);
  });
  it('answers /healthz without an identity', async () => {
    const { client } = await boot({ auth: closed });
    expect(await capture(await client.fetch('/healthz'))).toEqual(getHealthzAnswer);
  });
});

describe('HTTP contract: anonymous access', () => {
  it('answers an anonymous API call with 401 when the adapter can sign people in', async () => {
    const { client } = await boot({ auth: withLogin });
    expect(await capture(await client.fetch('/api/replays'))).toEqual(status401WithLoginUrlAnswer);
  });
  it('refuses an anonymous /api/replays with 403 when there is no sign-in', async () => {
    const { client } = await boot({ auth: closed });
    expect(await capture(await client.fetch('/api/replays'))).toEqual(status403ApiReplaysAnswer);
  });
  it('refuses an anonymous /api/replays/test-replay with 403 when there is no sign-in', async () => {
    const { client } = await boot({ auth: closed });
    expect(await capture(await client.fetch('/api/replays/test-replay'))).toEqual(status403ApiReplaysTestReplayAnswer);
  });
  it('refuses an anonymous /api/suites with 403 when there is no sign-in', async () => {
    const { client } = await boot({ auth: closed });
    expect(await capture(await client.fetch('/api/suites'))).toEqual(status403ApiSuitesAnswer);
  });
  it('refuses an anonymous /api/me with 403 when there is no sign-in', async () => {
    const { client } = await boot({ auth: closed });
    expect(await capture(await client.fetch('/api/me'))).toEqual(status403ApiMeAnswer);
  });
  it('refuses an anonymous /api/config with 403 when there is no sign-in', async () => {
    const { client } = await boot({ auth: closed });
    expect(await capture(await client.fetch('/api/config'))).toEqual(status403ApiConfigAnswer);
  });
  it('refuses an anonymous page load with 403 when there is no sign-in', async () => {
    const { client } = await boot({ auth: closed });
    expect(await capture(await client.fetch('/r/x', { headers: { accept: 'text/html' } }))).toEqual(status403PageAnswer);
  });
});

describe('HTTP contract: CLI and upload tokens', () => {
  it('keeps the CLI auth capabilities public', async () => {
    const { client } = await boot({ auth: uploadOnly });
    expect(await capture(await client.fetch('/api/cli/auth/capabilities'))).toEqual(capabilitiesAnswer);
  });
  it("reports an upload token's identity and scopes", async () => {
    const { client } = await boot({ auth: uploadOnly });
    expect(await capture(await client.fetch('/api/cli/auth/status'))).toEqual(statusUploadScopeAnswer);
  });
  it('refuses an upload token anything but uploads', async () => {
    const { client } = await boot({ auth: uploadOnly });
    expect(await capture(await client.fetch('/api/replays'))).toEqual(uploadTokenReadingTheListAnswer);
  });
  it('accepts an upload from an upload token', async () => {
    const { client } = await boot({ auth: uploadOnly });
    expect(await capture(await client.fetch('/api/replays', jsonInit('POST', replay('scoped-upload'))))).toEqual(uploadTokenUploadAnswer);
  });
  it('refuses a cross-site write from a browser', async () => {
    const { client } = await boot();
    expect(
      await capture(await client.fetch('/api/replays', jsonInit('POST', replay('cross-site'), { 'sec-fetch-site': 'cross-site' }))),
    ).toEqual(crossSitePOSTAnswer);
  });
});

describe('HTTP contract: the deployment and the person', () => {
  it('describes the deployment in /api/config', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch('/api/config'))).toEqual(getApiConfigAnswer);
  });
  it('names the signed-in person in /api/me', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch('/api/me'))).toEqual(getApiMeAnswer);
  });
  it('reports the signed-in identity to the CLI', async () => {
    const { client } = await boot();
    expect(await capture(await client.fetch('/api/cli/auth/status'))).toEqual(getApiCliAuthStatusAnswer);
  });
});

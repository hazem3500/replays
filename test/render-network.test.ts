import { createServer } from 'node:http';

import type { BrowserContext, Route } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';

import { assetAddress, guardRenderRequests, publicAddress } from '../src/server/media/browser-network.ts';

const origin = 'http://127.0.0.1:3000';

describe('render destinations', () => {
  it.each([
    '0.0.0.0',
    '10.2.3.4',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1',
    '100.127.255.254',
    '198.18.0.1',
    '224.0.0.1',
    '168.63.129.16',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:a00:1',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    'ff02::1',
    '64:ff9b::a00:1',
    '2002:a00:1::1',
    '2001::1',
  ])('rejects %s', (address) => {
    expect(publicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '100.128.0.1', '172.32.0.1', '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:808:808'])(
    'allows %s',
    (address) => {
      expect(publicAddress(address)).toBe(true);
    },
  );

  it('checks every DNS answer and resolves again on the next request', async () => {
    const resolve = vi
      .fn<() => Promise<Array<{ address: string; family: number }>>>()
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([
        { address: '8.8.8.8', family: 4 },
        { address: '::1', family: 6 },
      ]);
    const url = new URL('https://assets.example/image.png');
    await expect(assetAddress(url, origin, {}, resolve)).resolves.toEqual({ address: '8.8.8.8', family: 4 });
    await expect(assetAddress(url, origin, {}, resolve)).rejects.toThrow('blocked');
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it.each([
    'http://metadata.google.internal./',
    'http://localhost/',
    'http://2130706433/',
    'http://[::1]/',
    'ftp://example.com/',
    'file:///etc/hosts',
  ])('blocks %s', async (url) => {
    await expect(assetAddress(new URL(url), origin)).rejects.toThrow('blocked');
  });

  it('fails closed on resolution failures and empty answers', async () => {
    await expect(assetAddress(new URL('https://missing.example'), origin, {}, async () => [])).rejects.toThrow('blocked');
    await expect(
      assetAddress(new URL('https://missing.example'), origin, {}, async () => {
        throw new Error('DNS unavailable');
      }),
    ).rejects.toThrow('DNS');
  });

  it('allows the exact server origin and explicit internal hosts', async () => {
    await expect(assetAddress(new URL(origin), origin)).resolves.toMatchObject({ address: '127.0.0.1' });
    await expect(
      assetAddress(new URL('http://internal.example'), origin, { allowHosts: ['internal.example'] }, async () => [
        { address: '10.0.0.1', family: 4 },
      ]),
    ).resolves.toMatchObject({ address: '10.0.0.1' });
    await expect(assetAddress(new URL('https://public.example'), origin, { assets: 'origin-only' })).rejects.toThrow('blocked');
    await expect(
      assetAddress(new URL('http://internal.example.attacker.example'), origin, { allowHosts: ['internal.example'] }, async () => [
        { address: '10.0.0.1', family: 4 },
      ]),
    ).rejects.toThrow('blocked');
  });

  it('connects to the checked IP, does not follow redirects, and strips the render token off-origin', async () => {
    const received: Array<string | undefined> = [];
    const server = createServer((request, response) => {
      received.push(request.headers['x-render-token'] as string | undefined);
      response.writeHead(302, { location: 'http://169.254.169.254/latest/' });
      response.end('redirect');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('no port');
      const context = {
        route: vi.fn<(pattern: string, handler: (route: Route) => Promise<void>) => Promise<void>>(),
        routeWebSocket: vi.fn<() => Promise<void>>(),
      };
      await guardRenderRequests(
        context as unknown as BrowserContext,
        origin,
        { 'x-render-token': 'secret' },
        { allowHosts: ['assets.invalid'] },
        async () => [{ address: '127.0.0.1', family: 4 }],
      );
      const handle = context.route.mock.calls[0]![1] as (route: Route) => Promise<void>;
      const route = {
        request: () => ({
          url: () => `http://assets.invalid:${address.port}/image`,
          method: () => 'GET',
          headers: () => ({ 'x-render-token': 'secret' }),
          postDataBuffer: () => null,
        }),
        fulfill: vi.fn<Route['fulfill']>().mockResolvedValue(undefined),
        abort: vi.fn<Route['abort']>().mockResolvedValue(undefined),
      };
      await handle(route as unknown as Route);
      expect(route.fulfill).toHaveBeenCalledWith(
        expect.objectContaining({ status: 302, headers: expect.objectContaining({ location: 'http://169.254.169.254/latest/' }) }),
      );
      expect(route.abort).not.toHaveBeenCalled();
      expect(received).toEqual([undefined]);
      route.request = () => ({
        url: () => 'http://169.254.169.254/latest/',
        method: () => 'GET',
        headers: () => ({ 'x-render-token': 'secret' }),
        postDataBuffer: () => null,
      });
      await handle(route as unknown as Route);
      expect(route.abort).toHaveBeenCalledWith('blockedbyclient');
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});

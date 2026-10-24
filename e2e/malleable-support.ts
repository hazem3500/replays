import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { expect, type FrameLocator, type Page, type APIRequestContext } from '@playwright/test';

import { type Bundle, cloneBundle, openReplay, postBundle, uniqueId } from './support.ts';

/** demo-shop plus a realistic spread of failures, so "group failed requests by endpoint" has something to group. */
export async function seedFailingReplay(request: APIRequestContext, base: string) {
  const id = uniqueId('mall');
  const bundle: Bundle = await cloneBundle(request, base, 'demo-shop', id, 'Checkout with failures');
  const template = (bundle.network ?? [])[0]!;
  const failing: Array<[string, string, number, number]> = [
    ['GET', '/api/coupons/SPRING10', 404, 3200],
    ['GET', '/api/coupons/WELCOME5', 404, 3900],
    ['POST', '/api/orders', 500, 5200],
    ['POST', '/api/orders', 500, 6100],
    ['GET', '/api/users/1042/profile', 403, 6500],
    ['GET', '/api/users/2210/profile', 403, 6900],
    ['GET', '/api/products', 200, 7100],
  ];
  bundle.network = [
    ...(bundle.network ?? []).filter((entry) => Number(entry.status) < 400),
    ...failing.map(([method, path, status, at], index) => ({
      ...template,
      id: `fail-${index}`,
      method,
      url: `http://127.0.0.1:4173${path}`,
      status,
      statusText: status === 404 ? 'Not Found' : status === 403 ? 'Forbidden' : status === 500 ? 'Server Error' : 'OK',
      at,
      duration: 40 + index * 7,
    })),
  ];
  await postBundle(request, base, bundle);
  return id;
}

export const panelFrame = (page: Page, key: string): FrameLocator => page.getByTestId(`${key}-panel`).frameLocator('iframe');

export async function openMore(page: Page, itemTestId: string) {
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByTestId(itemTestId).click();
}

export async function openWorkshop(page: Page) {
  await openMore(page, 'malleable-open');
  await expect(page.getByTestId('workshop')).toBeVisible();
}

export async function closeWorkshop(page: Page) {
  await page.getByTestId('workshop-close').click();
  await expect(page.getByTestId('workshop')).toHaveCount(0);
}

/** Imports a plugin file through the workshop (the same path a person uses to load a shared file). */
export async function importPlugin(page: Page, file: { manifest: unknown; source: string }) {
  await page.getByTestId('plugin-import-input').setInputFiles({
    name: 'plugin.replays-plugin.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'replays-user-plugin/1', ...file })),
  });
}

export const manifestOf = (id: string, name: string, permissions: string[], contributes: Record<string, unknown>) => ({
  format: 'replays-user-plugin/1',
  id,
  name,
  permissions,
  contributes,
});

/** A server on another port that records every request: a plugin that reaches it has broken out of the sandbox. */
export async function startCanary() {
  const hits: string[] = [];
  const server: Server = createServer((request, response) => {
    hits.push(`${request.method} ${request.url}`);
    response.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'text/plain' });
    response.end('leaked');
  });
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
        // Blocked browser probes can leave a socket without an HTTP request.
        // Tear those down as well as keep-alive connections during cleanup.
        for (const socket of sockets) socket.destroy();
      }),
  };
}

export { openReplay };

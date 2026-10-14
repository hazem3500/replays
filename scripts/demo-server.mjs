// A tiny static server for the fictional demo shop (fixtures/demo-shop) with the three endpoints it calls.
// `/api/coupons/<code>` always answers 404 so the recording has a failed request and a console error to show.
// Used by scripts/record-sample.mjs, the e2e smoke test and the landing page's screenshots.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../fixtures/demo-shop');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const PRODUCTS = [
  { id: 'tea', name: 'Smoked pine tea', price: 14, color: '#c9d8c5' },
  { id: 'honey', name: 'Wildflower honey', price: 11, color: '#f1dca5' },
  { id: 'candle', name: 'Cedar candle', price: 19, color: '#e4cfc0' },
  { id: 'mug', name: 'Stoneware mug', price: 24, color: '#cbd5df' },
];

export function startDemoServer(port = 0) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://demo');
    if (url.pathname === '/api/products') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(PRODUCTS));
      return;
    }
    if (url.pathname.startsWith('/api/coupons/')) {
      response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unknown coupon' }));
      return;
    }
    const file = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }
    const body = await readFile(file).catch(() => undefined);
    if (!body) response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    else response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  });
  return new Promise((resolveStart) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolveStart({ server, origin: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}` });
    });
  });
}

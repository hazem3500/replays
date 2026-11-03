import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/headless.html', ['headless.html', 'text/html']],
  ['/client.js', ['client.js', 'text/javascript']],
  ['/client.css', ['client.css', 'text/css']],
  ['/headless.js', ['headless.js', 'text/javascript']],
  ['/src/headless.ts', ['headless.js', 'text/javascript']],
  ['/headless.css', ['headless.css', 'text/css']],
]);
createServer(async (request, response) => {
  const file = files.get(new URL(request.url ?? '/', 'http://localhost').pathname);
  if (!file) {
    response.writeHead(404).end();
    return;
  }
  try {
    const contents = await readFile(new URL(`../dist/${file[0]}`, import.meta.url));
    response.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` }).end(contents);
  } catch {
    response.writeHead(404).end('Build the example first.');
  }
}).listen(Number(process.argv[2] ?? process.env['PORT'] ?? 8082), '127.0.0.1');

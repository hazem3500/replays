import { request as httpRequest } from 'node:http';
import { runtimeBudgets as config } from '../../budgets/runtime.mjs';
import { percentile, summarize, violations } from './model.mjs';

const ENCODINGS = ['identity', 'gzip', 'br'];

function rawRequest(url, headers) {
  return new Promise((done, fail) => {
    const start = performance.now();
    const request = httpRequest(url, { headers, agent: false }, (response) => {
      const ttfbMs = performance.now() - start;
      let wireBytes = 0;
      response.on('data', (chunk) => {
        wireBytes += chunk.length;
      });
      response.on('error', fail);
      response.on('end', () =>
        done({
          metrics: { ttfbMs, responseMs: performance.now() - start, wireBytes },
          status: response.statusCode,
          headers: response.headers,
        }),
      );
    });
    request.setTimeout(15_000, () => request.destroy(new Error('server request timed out')));
    request.on('error', fail);
    request.end();
  });
}

async function sampleEndpoint(name, url, encoding) {
  const headers = { 'accept-encoding': encoding, accept: 'text/html', 'sec-fetch-mode': 'navigate' };
  const row = await rawRequest(url, headers);
  if (row.status !== 200) throw new Error(`${name}: expected 200, got ${row.status}`);
  const conditional = row.headers.etag ? await rawRequest(url, { ...headers, 'if-none-match': row.headers.etag }) : null;
  return { ...row, encoding, conditional };
}

function summarizeEndpoint(rows, budget) {
  const brotli = rows.filter((row) => row.encoding === 'br');
  const median = summarize(brotli);
  const ttfb = brotli.map((row) => row.metrics.ttfbMs);
  return {
    samples: rows,
    byEncoding: Object.fromEntries(ENCODINGS.map((encoding) => [encoding, summarize(rows.filter((row) => row.encoding === encoding))])),
    median,
    violations: violations(median, budget),
    ttfbP50Ms: percentile(ttfb, 0.5),
    ttfbP90Ms: percentile(ttfb, 0.9),
  };
}

/** Raw HTTP timings per content encoding for the configured API endpoints, plus the index HTML under the SSR gate. */
export async function measureEndpoints(server, { prefix, samples, ssrGate }) {
  const budgets = { ...config.server, ...(ssrGate ? { indexHtml: { path: '/', ...config.ssrGate.server } } : {}) };
  const reports = {};
  for (const [name, budget] of Object.entries(budgets)) {
    const count = name === 'indexHtml' ? config.ssrGate.serverSamples : samples;
    const url = `${server.origin}${prefix}${budget.path}`;
    const rows = [];
    for (const encoding of ENCODINGS) {
      for (let index = 0; index < count; index++) rows.push(await sampleEndpoint(name, url, encoding));
    }
    reports[name] = summarizeEndpoint(rows, budget);
  }
  return reports;
}

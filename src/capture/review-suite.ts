import type { ReviewRunRegistration, ReviewSuiteRegistration } from '../shared/review-suite.ts';

/** Small runner adapter for registering suites and runs on a replay server; auth headers stay in caller-owned memory. */
export class ReviewSuiteAdapter {
  private readonly apiBase: URL;
  private readonly headers: Record<string, string>;
  private readonly fetcher: typeof fetch;

  constructor(apiBaseUrl: string, headers: Record<string, string> = {}, fetcher: typeof fetch = fetch) {
    this.headers = headers;
    this.fetcher = fetcher;
    const apiBase = new URL(apiBaseUrl);
    const localHttp = apiBase.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(apiBase.hostname);
    if (apiBase.protocol !== 'https:' && !localHttp) throw new Error('review suite API must use HTTPS');
    if (apiBase.username || apiBase.password || apiBase.search || apiBase.hash) throw new Error('review suite API URL is invalid');
    apiBase.pathname = `${apiBase.pathname.replace(/\/$/, '')}/`;
    this.apiBase = apiBase;
  }

  registerSuite(suite: ReviewSuiteRegistration) {
    return this.put(`suites/${encodeURIComponent(suite.id)}`, suite);
  }

  registerRun(suiteId: string, run: ReviewRunRegistration) {
    return this.put(`suites/${encodeURIComponent(suiteId)}/runs/${encodeURIComponent(run.id)}`, run);
  }

  private async put(path: string, body: unknown) {
    const url = new URL(path, this.apiBase);
    const response = await this.fetcher(url, {
      method: 'PUT',
      headers: { ...this.headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`review suite registration failed (${response.status})`);
    return response.json() as Promise<unknown>;
  }
}

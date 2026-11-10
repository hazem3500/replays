import type { ReviewRunRegistration, ReviewSuite, ReviewSuiteRegistration, ReviewSuiteSummary } from '../shared/review-suite.ts';

/** A suite request the server refused or that never arrived; `status` is 0 when there was no response. */
export class ReviewSuiteHttpError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string, what = 'review suite request') {
    super(`${what} failed (${status || 'no response'})${detail ? `: ${detail}` : ''}`);
    this.name = 'ReviewSuiteHttpError';
    this.status = status;
    this.detail = detail;
  }
}

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
    return this.request<ReviewSuite>('PUT', `suites/${encodeURIComponent(suite.id)}`, suite);
  }

  registerRun(suiteId: string, run: ReviewRunRegistration) {
    return this.request<ReviewSuite>('PUT', `suites/${encodeURIComponent(suiteId)}/runs/${encodeURIComponent(run.id)}`, run);
  }

  /** The stored suite with its runs, or undefined when the server has none by that id. */
  async getSuite(id: string): Promise<ReviewSuite | undefined> {
    try {
      return await this.request<ReviewSuite>('GET', `suites/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof ReviewSuiteHttpError && error.status === 404) return undefined;
      throw error;
    }
  }

  /** The newest suites; `mine` keeps those the signed-in person is named on. */
  listSuites(options: { mine?: boolean; limit?: number } = {}) {
    const query = new URLSearchParams();
    if (options.mine) query.set('for', 'me');
    if (options.limit) query.set('limit', String(options.limit));
    const suffix = query.size ? `?${query}` : '';
    return this.request<Array<ReviewSuiteSummary & { reason?: string }>>('GET', `suites${suffix}`);
  }

  private async request<T>(method: 'GET' | 'PUT', path: string, body?: unknown): Promise<T> {
    const url = new URL(path, this.apiBase);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        redirect: 'manual',
        headers: { ...this.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ReviewSuiteHttpError(0, 'could not reach the server; check the configured URL and network');
    }
    if (response.status >= 300 && response.status < 400)
      throw new ReviewSuiteHttpError(response.status, 'redirected; check the server URL and sign-in setup');
    if (!response.ok) throw new ReviewSuiteHttpError(response.status, (await response.text().catch(() => '')).trim().slice(0, 300));
    return response.json() as Promise<T>;
  }
}

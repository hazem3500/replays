import { PRODUCT_NAME } from '../shared/brand.ts';

/**
 * What the server says about this deployment, for the router's context. In the browser it comes from index.html's
 * `<meta>` tags (src/server/base-path.ts `withBase`); a server render supplies it from the request instead, so
 * nothing that reads it from the router's context touches the DOM.
 */
export interface Deployment {
  /** `''` at the root of a domain, else a path prefix such as `/replays`. */
  base: string;
  name: string;
}

function meta(name: string) {
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? '';
}

/** The deployment as index.html declares it (the defaults without a document: unit tests, a server). */
export function readDeployment(): Deployment {
  if (typeof document === 'undefined') return { base: '', name: PRODUCT_NAME };
  const base = meta('app-base');
  const name = meta('app-name');
  return {
    base: !base || base === '/' ? '' : base.replace(/\/+$/, ''),
    name: name && name !== '__PRODUCT_NAME__' ? name : PRODUCT_NAME,
  };
}

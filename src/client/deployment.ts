import { PRODUCT_NAME } from '../shared/brand.ts';
import { type BetaFlags, betaFromTokens } from '../shared/beta-flags.ts';

/**
 * What the server says about this deployment, for the router's context: where the app lives, its branding, and
 * what the host enables. In the browser it comes from index.html's `<meta>` tags (src/server/base-path.ts
 * `withBase`); a server render supplies it from the request instead, so nothing that reads it touches the DOM.
 */
export interface Deployment {
  /** `''` at the root of a domain, else a path prefix such as `/replays`. */
  base: string;
  name: string;
  /** An https or data: image URL, or undefined for the built-in mark. */
  logo: string | undefined;
  /** What the server allows (the ceiling); a person can still opt out under Settings › Labs. */
  beta: BetaFlags;
  /** The host's edit write capability (beta.editor allowed and editing not turned off). */
  editing: boolean;
  comments: boolean;
}

function meta(name: string) {
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? '';
}

const filled = (value: string, placeholder: string) => (value && value !== placeholder ? value : undefined);

/** The deployment as index.html declares it (defaults without a document: unit tests, a server without a request). */
export function readDeployment(): Deployment {
  if (typeof document === 'undefined')
    return { base: '', name: PRODUCT_NAME, logo: undefined, beta: betaFromTokens(''), editing: false, comments: false };
  const base = meta('app-base');
  const beta = betaFromTokens(meta('app-beta'));
  return {
    base: !base || base === '/' ? '' : base.replace(/\/+$/, ''),
    name: filled(meta('app-name'), '__PRODUCT_NAME__') ?? PRODUCT_NAME,
    logo: filled(meta('app-logo'), '__PRODUCT_LOGO__'),
    beta,
    editing: beta.editor && meta('app-editing') !== 'off',
    comments: meta('app-comments') === 'on',
  };
}

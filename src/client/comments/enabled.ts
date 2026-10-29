import { pageMeta } from '../page-meta.ts';
let override: boolean | undefined;

/**
 * Whether comments are on (server: `comments.enabled`, default true; `REPLAYS_COMMENTS=false` turns them off). The
 * server writes it into index.html (`<meta name="app-comments" content="on">`). With it off the viewer shows no
 * comment UI and never asks for comments.
 */
export function commentsEnabled() {
  if (override !== undefined) return override;
  return pageMeta('app-comments') === 'on';
}

/** Tests only: force the flag without a document. */
export function setCommentsEnabledForTests(value: boolean | undefined) {
  override = value;
}

import { definePlugin } from '../plugin/define.ts';
import { COMMENT_RATE, handleCommentsApi } from './comments-routes.ts';
import { CommentsStore } from './comments-store.ts';
import { RateLimiter } from './rate-limit.ts';
import type { ReplayStore } from './store.ts';

/**
 * Comments on replays, as a built-in plugin: the API is a post-auth request hook, so it sits behind whatever auth
 * adapter is in use (plugin adapters included, whose identity, with its display name and avatar, becomes the
 * comment's author). The viewer's half (Comments tab, seek-bar markers, the `M` key) is the matching client feature,
 * src/client/comments/feature.ts, which the page activates when this plugin is loaded.
 *
 * The server loads it when comments are enabled (`REPLAYS_COMMENTS`, `comments.enabled`; on by default), so
 * "off" means the plugin is absent: no routes, no UI.
 */
export const COMMENTS_PLUGIN = 'comments';

export function commentsPlugin(deps: { store: ReplayStore; anonymous: boolean }) {
  return definePlugin({
    name: COMMENTS_PLUGIN,
    // Before the deployment's own plugins: their hooks see every request after comments had its routes.
    order: -100,
    setup(api) {
      const comments = new CommentsStore(deps.store.storage);
      const limiter = new RateLimiter(COMMENT_RATE.max, COMMENT_RATE.windowMs);
      api.onRequest(({ request, response, path, identity }) =>
        identity
          ? handleCommentsApi(request, response, path, { store: deps.store, comments, limiter, user: identity, anonymous: deps.anonymous })
          : false,
      );
    },
  });
}

import { MessageSquareIcon } from 'lucide-react';

import { registerViewerFeature } from '../plugins/features.tsx';
import { CommentsPanel } from './CommentsPanel.tsx';
import { CommentMarkers } from './CommentMarkers.tsx';
import { CommentsBridge, CommentsProvider, useComments } from './CommentsProvider.tsx';
import { commentsEnabled } from './enabled.ts';
import { prefetchCommentRows } from './rows.ts';

/**
 * Comments as a viewer feature (the client half of the built-in `comments` plugin, src/server/comments-plugin.ts):
 * the provider around the viewer, the Comments tab, and the markers on the seek bar. Active when the page says the
 * server loaded the plugin.
 */
export function registerCommentsFeature() {
  if (commentsEnabled()) prefetchCommentRows();
  registerViewerFeature({
    id: 'comments',
    enabled: commentsEnabled,
    Provider: ({ replayId, timeline, openPanel, registerStartAction, children }) => (
      <CommentsProvider replayId={replayId} timeline={timeline} openPanel={() => openPanel('comments')}>
        <CommentsBridge register={registerStartAction} />
        {children}
      </CommentsProvider>
    ),
    tab: {
      label: 'Comments',
      Icon: MessageSquareIcon,
      Panel: CommentsPanel,
      useBadge: () => useComments()?.count,
      shortcut: 'add-comment',
    },
    ScrubberOverlay: CommentMarkers,
  });
}

import { MessageSquareIcon } from 'lucide-react';
import { lazy, Suspense } from 'react';

import { registerViewerFeature } from '../plugins/features.tsx';
import { CommentsBridge, CommentsProvider, preloadCommentRows, useComments } from './CommentsProvider.tsx';
import { CommentsSkeleton } from '../viewer/PanelSkeletons.tsx';
import { commentsEnabled } from './enabled.ts';

let loadingUi: Promise<typeof import('./comments-ui.tsx')> | undefined;
const loadUi = () => (loadingUi ??= import('./comments-ui.tsx'));
const LazyPanel = lazy(() => loadUi().then((module) => ({ default: module.CommentsPanel })));
const LazyMarkers = lazy(() => loadUi().then((module) => ({ default: module.CommentMarkers })));

/** The Comments tab, from the comments UI chunk. why: the index and the first paint of a replay never pay for it. */
function CommentsTabPanel() {
  return (
    <Suspense fallback={<CommentsSkeleton />}>
      <LazyPanel />
    </Suspense>
  );
}

/** The seek-bar markers, from the same chunk; drawing the seek bar is what first asks for it. */
function CommentsScrubberOverlay(props: { width: number; inset: number }) {
  return (
    <Suspense fallback={null}>
      <LazyMarkers {...props} />
    </Suspense>
  );
}

/**
 * Comments as a viewer feature (the client half of the built-in `comments` plugin, src/server/comments-plugin.ts):
 * the provider around the viewer (in the main chunk: it owns `M` and the tab's count), and the Comments tab and seek-bar
 * markers (a lazy chunk with their styles). Active when the page says the server loaded the plugin. Resolves once the
 * rows chunk the provider renders from is loaded (at once when comments are off); it never rejects.
 */
export function registerCommentsFeature(): Promise<void> {
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
      Panel: CommentsTabPanel,
      useBadge: () => useComments()?.count,
      shortcut: 'add-comment',
    },
    ScrubberOverlay: CommentsScrubberOverlay,
  });
  // why: the provider suspends the viewer on this chunk; loaded with its code, no second skeleton swaps in mid-flight.
  return commentsEnabled() ? preloadCommentRows() : Promise.resolve();
}

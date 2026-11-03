import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  type CommentsResponse,
  type CommentThread,
  type Placement,
  placeComment,
  type PublicComment,
  sourceTimeAt,
  threadsOf,
} from '../../shared/comments.ts';
import type { EditTimeline } from '../../shared/edits.ts';
import { copyText } from '../clipboard.ts';
import { commentPermalink, parsePermalink } from '../permalink.ts';
import { usePlayer } from '../player.ts';
import { notify } from '../toast.ts';
import { formatClock } from '../../shared/replay.ts';
import type { NewCommentInput } from './api.ts';
import type { CommentRows } from '../data/comments.ts';
import { lazyPage } from '../routing/lazy-page.tsx';
import { loadCommentRowsSource } from './rows.ts';
import { setPageUrl } from '../routing/navigate.ts';

export interface PlacedThread extends CommentThread {
  placement: Placement;
}

/** A request to start a comment: the panel opens, the composer takes focus and pins the moment `at` (watched timeline). */
export interface ComposerRequest {
  id: number;
  at: number;
}

export interface CommentsApi {
  replayId: string;
  loaded: boolean;
  error: string | undefined;
  /** Loads the comments again (the failed-load state's "Try again"). */
  retry: () => void;
  me: CommentsResponse['me'] | undefined;
  /** No sign-in: comments are labelled "Anonymous" and anyone may change anonymous ones. */
  anonymous: boolean;
  threads: PlacedThread[];
  /** Pinned threads that have a place on the watched timeline (marker positions), ascending. */
  pins: Array<{ thread: PlacedThread; at: number }>;
  /** Comments and replies written as text (reactions are not counted). */
  count: number;
  selectedId: string | undefined;
  /** Select a thread: highlights it in the panel; `open` brings the panel up, `seek` moves the playhead to it. */
  reveal: (id: string, options?: { open?: boolean; seek?: boolean }) => void;
  /** Highlights a thread in the panel without moving the playhead (a comment just written). */
  select: (id: string) => void;
  composerRequest: ComposerRequest | undefined;
  consumeComposerRequest: () => void;
  /** `M`: pause, open the panel and start a comment at the playhead. */
  startComment: () => void;
  /** The watched timeline's ms for a new comment/reaction, as the SOURCE ms the server stores. */
  sourceTime: (watched: number) => number;
  create: (input: NewCommentInput) => Promise<PublicComment>;
  edit: (id: string, body: string) => Promise<PublicComment>;
  resolve: (id: string, resolved: boolean) => Promise<PublicComment>;
  remove: (id: string) => Promise<void>;
  copyLink: (thread: PlacedThread) => void;
  /** URL of the original recording at a removed comment's moment (the edited timeline cannot show it). */
  originalHref: (comment: PublicComment) => string;
}

const CommentsContext = createContext<CommentsApi | null>(null);

/** The comments of the open replay, or null when comments are off (no provider is mounted then). */
export function useComments() {
  return useContext(CommentsContext);
}

interface CommentsProviderProps {
  replayId: string;
  /** The saved edits' timeline when they are applied (beta editor), else undefined: times are source times. */
  timeline: EditTimeline | undefined;
  openPanel: () => void;
  children: ReactNode;
}

// why: once loaded with the viewer's code, the rows render at once; React.lazy would suspend the viewer for a tick.
const rowsSource = lazyPage(loadCommentRowsSource, (module) => module.CommentRowsSource);

/** Loads the rows chunk the provider renders from; the viewer's code loads it before its page renders. */
export const preloadCommentRows = () =>
  rowsSource.preload().then(
    () => {},
    () => {},
  );

/**
 * The open replay's comments: loaded once and refreshed in the background, placed on the timeline being watched
 * (`placeComment`: source time → edited time, with trimmed and cut moments marked removed), and the actions the
 * panel and the seek bar share. Mounted by the viewer only when comments are enabled. The rows come from a chunk of
 * their own (the TanStack DB data layer), loaded with the viewer's code (feature.tsx), so the viewer renders without
 * suspending once its page is ready.
 *
 * `openPanel` is how the viewer brings the Comments tab up (unfolding the bottom panel when it is folded).
 */
export function CommentsProvider(props: CommentsProviderProps) {
  return <rowsSource.Component replayId={props.replayId}>{(rows) => <CommentsBody {...props} rows={rows} />}</rowsSource.Component>;
}

function CommentsBody({ replayId, timeline, openPanel, children, rows }: CommentsProviderProps & { rows: CommentRows }) {
  const player = usePlayer();
  const { comments, loaded, error, me, anonymous, retry, create, edit, resolve, remove } = rows;
  const [selectedId, setSelectedId] = useState<string>();
  const [composerRequest, setComposerRequest] = useState<ComposerRequest>();
  const requests = useRef(0);

  const threads = useMemo<PlacedThread[]>(
    () => threadsOf(comments).map((thread) => ({ ...thread, placement: placeComment(thread.root.at, timeline) })),
    [comments, timeline],
  );
  const pins = useMemo(
    () =>
      threads
        .flatMap((thread) => (thread.placement.state === 'visible' ? [{ thread, at: thread.placement.at }] : []))
        .sort((a, b) => a.at - b.at),
    [threads],
  );
  const count = useMemo(() => comments.filter((comment) => !comment.emoji).length, [comments]);

  const threadsRef = useRef(threads);
  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);
  const openPanelRef = useRef(openPanel);
  useEffect(() => {
    openPanelRef.current = openPanel;
  }, [openPanel]);

  const reveal = useCallback<CommentsApi['reveal']>(
    (id, { open = true, seek = true } = {}) => {
      const thread = threadsRef.current.find((candidate) => candidate.root.id === id || candidate.replies.some((reply) => reply.id === id));
      if (!thread) return;
      setSelectedId(thread.root.id);
      if (open) openPanelRef.current();
      if (thread.placement.state === 'visible') {
        if (seek) player.seek(thread.placement.at);
      } else if (thread.placement.state === 'removed' && seek) {
        notify('That comment is in a section edited out of this replay', 'info', 'The original recording still shows it.');
      }
    },
    [player],
  );

  // A comment permalink (#comment-<id>) opens the panel and seeks to the comment, once the comments have loaded.
  const opened = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!loaded) return;
    const follow = () => {
      const target = parsePermalink(location.search, location.hash, 0).comment;
      if (!target || opened.current === target) return;
      opened.current = target;
      if (threadsRef.current.some((thread) => thread.root.id === target || thread.replies.some((reply) => reply.id === target)))
        reveal(target);
      else notify('That comment no longer exists', 'info');
    };
    follow();
    const onHash = () => {
      opened.current = undefined;
      follow();
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [loaded, reveal]);

  const startComment = useCallback(() => {
    player.pause();
    openPanelRef.current();
    setComposerRequest({ id: ++requests.current, at: player.getTime() });
  }, [player]);

  const api = useMemo<CommentsApi>(
    () => ({
      replayId,
      loaded,
      error: error ? error.message : undefined,
      retry,
      me,
      anonymous,
      threads,
      pins,
      count,
      selectedId,
      reveal,
      select: setSelectedId,
      composerRequest,
      consumeComposerRequest: () => setComposerRequest(undefined),
      startComment,
      sourceTime: (watched) => sourceTimeAt(watched, timeline),
      create,
      edit,
      resolve,
      async remove(id) {
        await remove(id);
        setSelectedId((current) => (current === id ? undefined : current));
      },
      copyLink(thread) {
        const at = thread.placement.state === 'visible' ? thread.placement.at : undefined;
        const url = commentPermalink(location.href, thread.root.id, at);
        setPageUrl(url);
        void copyText(url).then((copied) =>
          notify(copied ? `Link to the comment${at === undefined ? '' : ` at ${formatClock(at)}`} copied` : 'Could not copy the link'),
        );
      },
      originalHref(comment) {
        const url = new URL(location.href);
        url.searchParams.set('original', '1');
        if (comment.at === undefined) url.searchParams.delete('t');
        else url.searchParams.set('t', (comment.at / 1000).toFixed(1));
        url.hash = `comment-${comment.parentId ?? comment.id}`;
        return url.toString();
      },
    }),
    [
      anonymous,
      composerRequest,
      count,
      create,
      edit,
      error,
      loaded,
      me,
      pins,
      remove,
      replayId,
      resolve,
      retry,
      reveal,
      selectedId,
      startComment,
      threads,
      timeline,
    ],
  );

  return <CommentsContext.Provider value={api}>{children}</CommentsContext.Provider>;
}

/** Hands `startComment` (the `M` shortcut) to the viewer, which owns the keyboard but sits outside the provider. */
export function CommentsBridge({ register }: { register: (start: (() => void) | undefined) => void }) {
  const comments = useComments();
  const start = comments?.startComment;
  useEffect(() => {
    register(start);
    return () => register(undefined);
  }, [register, start]);
  return null;
}

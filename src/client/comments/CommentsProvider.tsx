import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { commentsQuery, createComment, deleteComment, editComment, type NewCommentInput, resolveComment } from './api.ts';

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

/**
 * The open replay's comments: loaded once and refreshed in the background, placed on the timeline being watched
 * (`placeComment`: source time → edited time, with trimmed and cut moments marked removed), and the actions the
 * panel and the seek bar share. Mounted by the viewer only when comments are enabled.
 *
 * `openPanel` is how the viewer brings the Comments tab up (unfolding the bottom panel when it is folded).
 */
export function CommentsProvider({
  replayId,
  timeline,
  openPanel,
  children,
}: {
  replayId: string;
  /** The saved edits' timeline when they are applied (beta editor), else undefined: times are source times. */
  timeline: EditTimeline | undefined;
  openPanel: () => void;
  children: ReactNode;
}) {
  const player = usePlayer();
  const client = useQueryClient();
  const query = useQuery(commentsQuery(replayId));
  const key = commentsQuery(replayId).queryKey;
  const [selectedId, setSelectedId] = useState<string>();
  const [composerRequest, setComposerRequest] = useState<ComposerRequest>();
  const requests = useRef(0);

  const threads = useMemo<PlacedThread[]>(
    () => threadsOf(query.data?.comments ?? []).map((thread) => ({ ...thread, placement: placeComment(thread.root.at, timeline) })),
    [query.data?.comments, timeline],
  );
  const pins = useMemo(
    () =>
      threads
        .flatMap((thread) => (thread.placement.state === 'visible' ? [{ thread, at: thread.placement.at }] : []))
        .sort((a, b) => a.at - b.at),
    [threads],
  );
  const count = useMemo(() => (query.data?.comments ?? []).filter((comment) => !comment.emoji).length, [query.data?.comments]);

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
    if (!query.data) return;
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
  }, [query.data, reveal]);

  const startComment = useCallback(() => {
    player.pause();
    openPanelRef.current();
    setComposerRequest({ id: ++requests.current, at: player.getTime() });
  }, [player]);

  const merge = useCallback(
    (change: (comments: PublicComment[]) => PublicComment[]) =>
      client.setQueryData<CommentsResponse>(key, (old) => (old ? { ...old, comments: change(old.comments) } : old)),
    [client, key],
  );
  const replace = useCallback(
    (saved: PublicComment) => {
      merge((comments) => comments.map((comment) => (comment.id === saved.id ? saved : comment)));
      return saved;
    },
    [merge],
  );

  const api = useMemo<CommentsApi>(
    () => ({
      replayId,
      loaded: query.data !== undefined,
      error: query.error ? query.error.message : undefined,
      me: query.data?.me,
      anonymous: Boolean(query.data?.anonymous),
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
      async create(input) {
        const saved = await createComment(replayId, input);
        merge((comments) => [...comments, saved]);
        return saved;
      },
      async edit(id, body) {
        return replace(await editComment(replayId, id, body));
      },
      async resolve(id, resolved) {
        return replace(await resolveComment(replayId, id, resolved));
      },
      async remove(id) {
        await deleteComment(replayId, id);
        merge((comments) => comments.filter((comment) => comment.id !== id && comment.parentId !== id));
        setSelectedId((current) => (current === id ? undefined : current));
      },
      copyLink(thread) {
        const at = thread.placement.state === 'visible' ? thread.placement.at : undefined;
        const url = commentPermalink(location.href, thread.root.id, at);
        history.replaceState(history.state, '', url);
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
    [composerRequest, count, merge, pins, query.data, query.error, replace, replayId, reveal, selectedId, startComment, threads, timeline],
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

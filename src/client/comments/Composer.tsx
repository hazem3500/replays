import { ArrowUpIcon, XIcon } from 'lucide-react';
import { type KeyboardEvent, useId, useRef, useState } from 'react';

import { MAX_COMMENT_BODY } from '../../shared/comments.ts';
import { formatClock } from '../../shared/replay.ts';
import { Hint } from '@/components/icon-button.tsx';
import { useComposerRequest } from '../hooks/use-composer-request.ts';
import { usePlayer, usePlayhead } from '../player.ts';
import { isMacPlatform } from '../shortcuts.ts';
import type { CommentsApi } from './CommentsProvider.tsx';
import { reportFailure } from './failure.ts';
import { ReactionPicker } from './Reactions.tsx';
import { commentStrings } from './strings.ts';

/** Within this many ms of the playhead, the pinned moment counts as "now" and offers no re-pin. */
const DRIFT_MS = 100;

/**
 * The composer docked under the comments: a plain box that grows with its text, a send arrow once there is something
 * to send, and one quiet line under it saying where the comment goes. The moment follows the playhead until typing
 * starts (or `M` pins one); × turns it into a whole-replay comment. Cmd/Ctrl+Enter sends; Escape leaves the box.
 */
export function Composer({ comments }: { comments: CommentsApi }) {
  const player = usePlayer();
  const field = useRef<HTMLTextAreaElement>(null);
  const noteId = useId();
  const [text, setText] = useState('');
  const [whole, setWhole] = useState(false);
  const [anchor, setAnchor] = useState<number>();
  const [handled, setHandled] = useState<number>();
  const { composerRequest } = comments;
  if (composerRequest && composerRequest.id !== handled) {
    setHandled(composerRequest.id);
    setWhole(false);
    setAnchor(composerRequest.at);
  }
  useComposerRequest(composerRequest, comments.consumeComposerRequest, field);

  const submit = async () => {
    const body = text;
    if (!body.trim()) return;
    const at = anchor ?? player.getTime();
    setText('');
    setAnchor(undefined);
    try {
      const saved = await comments.create({ body, ...(whole ? {} : { at: comments.sourceTime(at) }) });
      comments.select(saved.id);
    } catch (error) {
      reportFailure(error);
      setText((current) => current || body);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    } else if (event.key === 'Escape') {
      event.currentTarget.blur();
    }
  };
  const onChange = (value: string) => {
    if (!text && value && anchor === undefined) setAnchor(player.getTime());
    if (!value) setAnchor(undefined);
    setText(value);
  };

  return (
    <form
      className="comment-composer"
      data-testid="comment-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="comment-composer-box">
        <textarea
          ref={field}
          className="comment-composer-input"
          data-testid="comment-input"
          aria-label={whole ? commentStrings.placeholderWhole : commentStrings.placeholder}
          aria-describedby={noteId}
          rows={1}
          maxLength={MAX_COMMENT_BODY}
          placeholder={whole ? commentStrings.placeholderWhole : commentStrings.placeholder}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <ReactionPicker comments={comments} />
        {text.trim() ? <SendButton /> : null}
      </div>
      <ComposerNote
        id={noteId}
        anchor={anchor}
        whole={whole}
        length={text.length}
        anonymous={comments.anonymous}
        onWhole={setWhole}
        onAnchor={setAnchor}
      />
    </form>
  );
}

/** The quiet line under the box: where the comment goes, the characters left near the limit, and anonymity. */
function ComposerNote({
  id,
  length,
  anonymous,
  ...placement
}: {
  id: string;
  anchor: number | undefined;
  whole: boolean;
  length: number;
  anonymous: boolean;
  onWhole: (whole: boolean) => void;
  onAnchor: (at: number) => void;
}) {
  return (
    <div className="comment-composer-note" id={id}>
      <Placement {...placement} />
      {length > MAX_COMMENT_BODY - 200 ? (
        <span className="comment-count" aria-live="polite">
          {MAX_COMMENT_BODY - length}
        </span>
      ) : null}
      {anonymous ? (
        <span className="comment-anonymous" data-testid="comments-anonymous-notice" title={commentStrings.anonymousDetail}>
          {commentStrings.anonymous}
        </span>
      ) : null}
    </div>
  );
}

function SendButton() {
  return (
    <Hint label={commentStrings.send} shortcut={isMacPlatform() ? '⌘ ↵' : 'Ctrl ↵'}>
      <button type="submit" className="comment-send" aria-label={commentStrings.send} data-testid="comment-submit">
        <ArrowUpIcon aria-hidden="true" />
      </button>
    </Hint>
  );
}

/**
 * Where the comment goes, as plain text: "At 0:06.7" with × for the whole replay, or "Whole replay" with a way back
 * to the playhead. Subscribes to the playhead on its own, so the composer around it does not render per frame.
 */
function Placement({
  anchor,
  whole,
  onWhole,
  onAnchor,
}: {
  anchor: number | undefined;
  whole: boolean;
  onWhole: (whole: boolean) => void;
  onAnchor: (at: number) => void;
}) {
  const player = usePlayer();
  const live = usePlayhead((time) => Math.round(time / DRIFT_MS) * DRIFT_MS);
  if (whole)
    return (
      <span className="comment-placement">
        <span data-testid="comment-pin">{commentStrings.wholeReplay}</span>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          className="comment-note-action"
          data-testid="comment-pin-set"
          onClick={() => {
            onAnchor(player.getTime());
            onWhole(false);
          }}
        >
          {commentStrings.pinTo(formatClock(live))}
        </button>
      </span>
    );
  const at = anchor ?? live;
  const drifted = anchor !== undefined && Math.abs(anchor - live) >= DRIFT_MS;
  return (
    <span className="comment-placement">
      {commentStrings.pinnedAt}{' '}
      <span className="comment-placement-time" data-testid="comment-pin">
        {formatClock(at)}
      </span>
      <Hint label={commentStrings.unpin}>
        <button
          type="button"
          className="comment-unpin"
          aria-label={commentStrings.unpin}
          data-testid="comment-pin-clear"
          onClick={() => onWhole(true)}
        >
          <XIcon aria-hidden="true" />
        </button>
      </Hint>
      {drifted ? (
        <>
          <span aria-hidden="true">·</span>
          <button type="button" className="comment-note-action" data-testid="comment-pin-sync" onClick={() => onAnchor(player.getTime())}>
            {commentStrings.moveTo(formatClock(live))}
          </button>
        </>
      ) : null}
    </span>
  );
}

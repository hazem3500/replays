import { MapPinIcon, RefreshCwIcon, SendIcon } from 'lucide-react';
import { type KeyboardEvent, useId, useRef, useState } from 'react';

import { MAX_COMMENT_BODY } from '../../shared/comments.ts';
import { formatClock } from '../../shared/replay.ts';
import { Button } from '@/components/ui/button.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { Hint } from '@/components/icon-button.tsx';
import { useComposerRequest } from '../hooks/use-composer-request.ts';
import { usePlayer, usePlayhead } from '../player.ts';
import { isMacPlatform } from '../shortcuts.ts';
import type { CommentsApi } from './CommentsProvider.tsx';
import { keepFocus } from './composer-focus.ts';
import { reportFailure } from './failure.ts';
import { ReactionPicker } from './Reactions.tsx';
import { commentStrings } from './strings.ts';

/** Within this many ms of the playhead, the pinned moment counts as "now" and offers no re-pin. */
const DRIFT_MS = 100;

/**
 * The composer docked under the comments: one quiet line that grows while it has focus or text. Its time chip follows
 * the playhead until typing starts (or `M` pins a moment), toggles between that moment and the whole replay, and
 * offers to move to the playhead when it has drifted. Cmd/Ctrl+Enter sends; Escape leaves the box.
 */
export function Composer({ comments }: { comments: CommentsApi }) {
  const player = usePlayer();
  const field = useRef<HTMLTextAreaElement>(null);
  const footId = useId();
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
      data-filled={text ? '' : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="comment-composer-box">
        <PinChip anchor={anchor} whole={whole} onWhole={setWhole} onAnchor={setAnchor} />
        <textarea
          ref={field}
          className="comment-input comment-composer-input"
          data-testid="comment-input"
          aria-label={whole ? commentStrings.placeholderWhole : 'New comment'}
          aria-describedby={comments.anonymous ? footId : undefined}
          rows={1}
          maxLength={MAX_COMMENT_BODY}
          placeholder={whole ? commentStrings.placeholderWhole : commentStrings.placeholder}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Kbd className="comment-composer-kbd" aria-hidden="true">
          M
        </Kbd>
        <ReactionPicker comments={comments} />
        <SendGroup text={text} />
      </div>
      {comments.anonymous ? <AnonymousNote id={footId} /> : null}
    </form>
  );
}

/** The send button (Cmd/Ctrl+Enter) and, near the limit, how many characters are left. */
function SendGroup({ text }: { text: string }) {
  return (
    <div className="comment-composer-send">
      {text.length > MAX_COMMENT_BODY - 200 ? (
        <span className="comment-count" aria-live="polite">
          {MAX_COMMENT_BODY - text.length}
        </span>
      ) : null}
      <Hint label="Send" shortcut={isMacPlatform() ? '⌘ ↵' : 'Ctrl ↵'}>
        <Button type="submit" size="sm" disabled={!text.trim()} data-testid="comment-submit">
          <SendIcon aria-hidden="true" />
          Comment
        </Button>
      </Hint>
    </div>
  );
}

/** Shown while composing on a server without sign-in, and read out as the box's description. */
function AnonymousNote({ id }: { id: string }) {
  return (
    <p id={id} className="comment-composer-foot" data-testid="comments-anonymous-notice" role="note">
      {commentStrings.anonymous}
    </p>
  );
}

/**
 * Where the comment goes: the pinned moment (or the live playhead while nothing is pinned), or the whole replay.
 * Subscribes to the playhead on its own, so the composer around it does not render per frame.
 */
function PinChip({
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
  const at = anchor ?? live;
  const drifted = !whole && anchor !== undefined && Math.abs(anchor - live) >= DRIFT_MS;
  return (
    <span className="comment-pin-wrap">
      <Hint label={whole ? 'On the whole replay. Click to pin it to a moment' : `Pinned to ${formatClock(at)}. Click for the whole replay`}>
        <button
          type="button"
          className="comment-pin"
          data-testid="comment-pin"
          aria-pressed={!whole}
          onMouseDown={keepFocus}
          onClick={() => {
            if (whole) onAnchor(player.getTime());
            onWhole(!whole);
          }}
        >
          <MapPinIcon aria-hidden="true" />
          {whole ? commentStrings.wholeReplay : formatClock(at)}
        </button>
      </Hint>
      {drifted ? (
        <Hint label={`Move to the playhead, ${formatClock(live)}`}>
          <button
            type="button"
            className="comment-pin-sync"
            data-testid="comment-pin-sync"
            aria-label={`Move to the playhead, ${formatClock(live)}`}
            onMouseDown={keepFocus}
            onClick={() => onAnchor(player.getTime())}
          >
            <RefreshCwIcon aria-hidden="true" />
          </button>
        </Hint>
      ) : null}
    </span>
  );
}

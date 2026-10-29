import { SmilePlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';

import { REACTION_EMOJI } from '../../shared/comments.ts';
import { formatClock } from '../../shared/replay.ts';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { Hint } from '@/components/icon-button.tsx';
import { usePlayer } from '../player.ts';
import type { CommentsApi, PlacedThread } from './CommentsProvider.tsx';
import { keepFocus } from './composer-focus.ts';
import { reportFailure } from './failure.ts';

/** One button that opens the reaction set; a pick reacts at the playhead and closes it. */
export function ReactionPicker({ comments }: { comments: CommentsApi }) {
  const player = usePlayer();
  const [open, setOpen] = useState(false);
  const react = async (emoji: string) => {
    try {
      await comments.create({ emoji, at: comments.sourceTime(player.getTime()) });
    } catch (error) {
      reportFailure(error);
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint label="React at the playhead" disabled={open}>
        <PopoverTrigger
          className="comment-react-trigger"
          data-testid="comment-react"
          aria-label="React at the playhead"
          onMouseDown={keepFocus}
        >
          <SmilePlusIcon aria-hidden="true" />
        </PopoverTrigger>
      </Hint>
      <PopoverContent side="top" align="end" className="comment-react-popup">
        <div role="group" aria-label="Reactions" className="comment-react-set">
          {REACTION_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="comment-react-button"
              data-testid="react"
              aria-label={`React ${emoji}`}
              onClick={() => {
                setOpen(false);
                void react(emoji);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Reactions that sit next to each other in time, as one quiet line of chips: emoji, who, and the moment (a click goes
 * there). People can take back their own.
 */
export function ReactionRow({
  threads,
  comments,
  activeId,
}: {
  threads: PlacedThread[];
  comments: CommentsApi;
  activeId: string | undefined;
}) {
  return (
    <li className="comment-reactions" data-testid="comment-reactions">
      {threads.map((thread) => (
        <ReactionChip key={thread.root.id} thread={thread} comments={comments} active={thread.root.id === activeId} />
      ))}
    </li>
  );
}

function ReactionChip({ thread, comments, active }: { thread: PlacedThread; comments: CommentsApi; active: boolean }) {
  const player = usePlayer();
  const { root, placement } = thread;
  const at = placement.state === 'visible' ? placement.at : undefined;
  const label = `${root.author.name} reacted ${root.emoji}${at === undefined ? '' : ` at ${formatClock(at)}`}`;
  const remove = async () => {
    try {
      await comments.remove(root.id);
    } catch (error) {
      reportFailure(error);
    }
  };
  return (
    <span
      className="comment-reaction-chip"
      data-thread-id={root.id}
      data-active={active || undefined}
      data-selected={comments.selectedId === root.id || undefined}
    >
      <button
        type="button"
        className="comment-reaction-go"
        aria-label={at === undefined ? label : `${label}. Go there`}
        disabled={at === undefined}
        onClick={() => {
          if (at === undefined) return;
          comments.reveal(root.id, { open: false });
          player.seek(at);
        }}
      >
        <span className="comment-reaction" data-testid="comment-reaction">
          {root.emoji}
        </span>
        <span className="comment-reaction-who">{root.mine ? 'You' : root.author.name}</span>
        {at === undefined ? null : <span className="comment-reaction-at">{formatClock(at)}</span>}
      </button>
      {root.mine ? (
        <Hint label="Remove your reaction">
          <button
            type="button"
            className="comment-reaction-remove"
            data-testid="comment-reaction-remove"
            aria-label={`Remove your ${root.emoji} reaction`}
            onClick={() => void remove()}
          >
            <XIcon aria-hidden="true" />
          </button>
        </Hint>
      ) : null}
    </span>
  );
}

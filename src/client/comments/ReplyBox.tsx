import { useRef, useState } from 'react';

import { MAX_COMMENT_BODY, type PublicComment } from '../../shared/comments.ts';
import { Button } from '@/components/ui/button.tsx';
import { useFocusWhen } from '../hooks/use-focus-when.ts';
import type { CommentsApi } from './CommentsProvider.tsx';
import { reportFailure } from './failure.ts';
import { commentStrings } from './strings.ts';

/** A reply box under a thread, or the edit box of an existing comment. Cmd/Ctrl+Enter saves, Escape cancels. */
export function ReplyBox({
  comments,
  parentId,
  editing,
  onDone,
}: {
  comments: CommentsApi;
  parentId?: string;
  editing?: PublicComment;
  onDone: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(editing?.body ?? '');
  const [pending, setPending] = useState(false);
  useFocusWhen(field, true);
  const submit = async () => {
    if (!text.trim() || pending) return;
    setPending(true);
    try {
      if (editing) await comments.edit(editing.id, text);
      else if (parentId) await comments.create({ body: text, parentId });
      onDone();
    } catch (error) {
      reportFailure(error);
      setPending(false);
    }
  };
  return (
    <div className="comment-reply-box">
      <textarea
        ref={field}
        className="comment-input"
        data-testid={editing ? 'comment-edit-input' : 'comment-reply-input'}
        aria-label={editing ? 'Edit comment' : 'Reply'}
        rows={2}
        maxLength={MAX_COMMENT_BODY}
        placeholder={commentStrings.replyPlaceholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onFocus={(event) => event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onDone();
          }
        }}
      />
      <div className="comment-reply-actions">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!text.trim() || pending}
          onClick={() => void submit()}
          data-testid={editing ? 'comment-edit-save' : 'comment-reply-send'}
        >
          {editing ? 'Save' : 'Reply'}
        </Button>
      </div>
    </div>
  );
}

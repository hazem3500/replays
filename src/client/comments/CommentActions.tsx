import { CheckIcon, EllipsisIcon, LinkIcon, PencilIcon, ReplyIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx';
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from '@/components/ui/drawer.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu.tsx';
import { Hint } from '@/components/icon-button.tsx';
import { commentStrings } from './strings.ts';

/** What one comment offers; absent handlers are not shown (only authors edit and delete, only threads resolve). */
export interface CommentActionSet {
  onReply?: (() => void) | undefined;
  onResolve?: (() => void) | undefined;
  resolved?: boolean;
  onCopyLink: () => void;
  onEdit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}

/**
 * Desktop: Reply and Resolve as quiet text buttons and the rest behind one overflow, all shown on hover or focus of
 * the comment.
 */
export function HoverActions({ actions }: { actions: CommentActionSet }) {
  return (
    <span className="comment-actions">
      {actions.onReply ? (
        <button type="button" className="comment-text-action" data-testid="comment-reply" onClick={actions.onReply}>
          {commentStrings.reply}
        </button>
      ) : null}
      {actions.onResolve ? (
        <button type="button" className="comment-text-action" data-testid="comment-resolve" onClick={actions.onResolve}>
          {actions.resolved ? commentStrings.reopen : commentStrings.resolve}
        </button>
      ) : null}
      <DropdownMenu>
        <Hint label={commentStrings.more}>
          <DropdownMenuTrigger className="comment-more" aria-label={commentStrings.more} data-testid="comment-more">
            <EllipsisIcon aria-hidden="true" />
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent side="bottom" align="end" className="comment-menu">
          <DropdownMenuItem onClick={actions.onCopyLink} data-testid="comment-copy-link">
            <LinkIcon aria-hidden="true" />
            {commentStrings.copyLink}
          </DropdownMenuItem>
          {actions.onEdit ? (
            <DropdownMenuItem onClick={actions.onEdit} data-testid="comment-edit">
              <PencilIcon aria-hidden="true" />
              {commentStrings.edit}
            </DropdownMenuItem>
          ) : null}
          {actions.onDelete ? (
            <DropdownMenuItem variant="destructive" onClick={actions.onDelete} data-testid="comment-delete">
              <Trash2Icon aria-hidden="true" />
              {commentStrings.delete}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function SheetRow({
  icon,
  label,
  onSelect,
  testId,
  danger,
}: {
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  testId: string;
  danger?: boolean;
}) {
  return (
    <li>
      {/* why: the sheet closes first, so a box or dialog that opens next takes focus from a settled page. */}
      <DrawerClose
        className="comment-sheet-row"
        data-danger={danger ? '' : undefined}
        data-testid={testId}
        onClick={() => requestAnimationFrame(onSelect)}
      >
        <span className="comment-sheet-icon" aria-hidden="true">
          {icon}
        </span>
        {label}
      </DrawerClose>
    </li>
  );
}

/** Phones: tapping a comment opens its actions in a bottom sheet, in thumb reach, with 48 px rows. */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  actions: CommentActionSet;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="comment-sheet" data-testid="comment-sheet">
        <DrawerTitle className="comment-sheet-title" title={title}>
          {title}
        </DrawerTitle>
        <ul className="comment-sheet-list">
          {actions.onReply ? (
            <SheetRow icon={<ReplyIcon />} label={commentStrings.reply} onSelect={actions.onReply} testId="comment-sheet-reply" />
          ) : null}
          {actions.onResolve ? (
            <SheetRow
              icon={actions.resolved ? <RotateCcwIcon /> : <CheckIcon />}
              label={actions.resolved ? commentStrings.reopen : commentStrings.resolve}
              onSelect={actions.onResolve}
              testId="comment-sheet-resolve"
            />
          ) : null}
          <SheetRow icon={<LinkIcon />} label={commentStrings.copyLink} onSelect={actions.onCopyLink} testId="comment-sheet-copy-link" />
          {actions.onEdit ? (
            <SheetRow icon={<PencilIcon />} label={commentStrings.edit} onSelect={actions.onEdit} testId="comment-sheet-edit" />
          ) : null}
          {actions.onDelete ? (
            <SheetRow
              icon={<Trash2Icon />}
              label={commentStrings.delete}
              onSelect={actions.onDelete}
              testId="comment-sheet-delete"
              danger
            />
          ) : null}
        </ul>
      </DrawerContent>
    </Drawer>
  );
}

/** Deleting asks first, in a dialog; a thread's replies go with it. */
export function DeleteDialog({
  open,
  onOpenChange,
  reply,
  replies,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reply: boolean;
  replies: number;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog" showCloseButton={false} className="comment-delete-dialog">
        <DialogHeader>
          <DialogTitle>{reply ? commentStrings.deleteReplyTitle : commentStrings.deleteTitle}</DialogTitle>
          <DialogDescription>{commentStrings.deleteBody(reply ? 0 : replies)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{commentStrings.cancel}</DialogClose>
          <Button variant="destructive" data-testid="comment-delete-confirm" onClick={onConfirm}>
            {commentStrings.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

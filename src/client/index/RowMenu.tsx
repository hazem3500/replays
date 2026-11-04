import { Fragment } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';

import { copyText } from '../clipboard.ts';
import type { RowMenuState } from '../hooks/use-row-menu.ts';
import { notify } from '../toast.ts';
import type { RowAction } from './row-actions.ts';

const STRINGS = { copied: 'Link copied', failed: 'Could not copy the link' };

async function copyRowLink(href: string) {
  const ok = await copyText(new URL(href, window.location.origin).href);
  notify(ok ? STRINGS.copied : STRINGS.failed);
}

function RowMenuItem({ action, onDelete }: { action: RowAction; onDelete: (() => void) | undefined }) {
  const icon = <AnimatedIcon name={action.icon} />;
  if (action.id === 'delete') {
    return (
      <DropdownMenuItem variant="destructive" onClick={onDelete}>
        {icon}
        {action.label}
      </DropdownMenuItem>
    );
  }
  if (action.id === 'copy-link') {
    return (
      <DropdownMenuItem onClick={() => void copyRowLink(action.href)}>
        {icon}
        {action.label}
      </DropdownMenuItem>
    );
  }
  const newTab = action.id === 'open-new-tab' ? { target: '_blank', rel: 'noopener' } : {};
  return (
    <DropdownMenuItem
      render={<a href={action.href} {...newTab} />}
      className="text-inherit no-underline"
      disabled={action.disabled ?? false}
    >
      {icon}
      {action.label}
    </DropdownMenuItem>
  );
}

function RowMenuItems({ actions, onDelete }: { actions: readonly RowAction[]; onDelete: (() => void) | undefined }) {
  return actions.map((action) => (
    <Fragment key={action.id}>
      {action.id === 'delete' ? <DropdownMenuSeparator /> : null}
      <RowMenuItem action={action} onDelete={onDelete} />
    </Fragment>
  ));
}

/**
 * A row's actions in two doors onto one list: the "⋯" button, and the menu a right click opens at the pointer
 * (`menu`, from useRowMenu). Both are drawn from `actions`, so they cannot differ.
 */
export function RowMenu({
  title,
  actions,
  menu,
  onDelete,
}: {
  title: string;
  actions: readonly RowAction[];
  menu: RowMenuState;
  onDelete?: () => void;
}) {
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="row-menu relative z-2 ml-3 size-8 shrink-0 pointer-coarse:size-11"
              aria-label={`Actions for ${title}`}
            />
          }
        >
          <AnimatedIcon name="ellipsis" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-44">
          <RowMenuItems actions={actions} onDelete={onDelete} />
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu open={menu.open} onOpenChange={menu.onOpenChange}>
        <DropdownMenuContent
          align="start"
          sideOffset={0}
          className="w-auto min-w-44"
          aria-label={`Actions for ${title}`}
          finalFocus={() => menu.returnTo}
          {...(menu.anchor ? { anchor: menu.anchor } : {})}
        >
          <RowMenuItems actions={actions} onDelete={onDelete} />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

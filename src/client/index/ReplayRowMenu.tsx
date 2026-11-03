import { AnimatedIcon } from '@/components/animated-icon.tsx';

import { Button } from '@/components/ui/button.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu.tsx';
import { useReplayDeletion } from '../hooks/use-replay-deletion.tsx';

/** Per-recording actions are separate from the stretched card link and never act on a suite. */
export function ReplayRowMenu({ id, title }: { id: string; title: string }) {
  const deletion = useReplayDeletion(id, title);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="relative z-2 ml-3 size-8 shrink-0 pointer-coarse:size-11"
              aria-label={`Actions for ${title}`}
            />
          }
        >
          <AnimatedIcon name="ellipsis" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onClick={deletion.requestDelete}>
            <AnimatedIcon name="trash-2" />
            Delete replay
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {deletion.dialog}
    </>
  );
}

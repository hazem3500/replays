import { ArrowLeftIcon, PlayIcon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { formatClock } from '../../../shared/replay.ts';
import { IconButton } from '@/components/icon-button.tsx';
import { Button } from '@/components/ui/button.tsx';
import { usePlayer } from '../../player.ts';

const STRINGS = {
  back: 'Back to the list',
  watch: (at: number) => `Watch from ${formatClock(at)}`,
};

/**
 * A detail's sticky head, shared by the Network and Performance details: what it is (`children`), "Watch from" (seeks
 * to `at`) and close; on a narrow panel, where the detail replaces the list, a back button instead of close.
 */
export function DetailHead({
  at,
  stacked,
  closeLabel,
  onClose,
  children,
}: {
  at: number;
  stacked: boolean;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const player = usePlayer();
  return (
    <header className="np-detail-head">
      {stacked ? (
        <Button variant="ghost" size="sm" className="np-back" aria-label={STRINGS.back} onClick={onClose}>
          <ArrowLeftIcon aria-hidden="true" />
        </Button>
      ) : null}
      <span className="np-detail-status">{children}</span>
      <span className="np-spacer" />
      <Button variant="ghost" size="sm" className="np-watch" onClick={() => player.seek(at)}>
        <PlayIcon aria-hidden="true" />
        {STRINGS.watch(at)}
      </Button>
      {stacked ? null : (
        <IconButton label={closeLabel} size="icon-sm" onClick={onClose}>
          <XIcon />
        </IconButton>
      )}
    </header>
  );
}

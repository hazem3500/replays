import { cn } from '@/lib/utils.ts';

/** The play button's wait mark: a small ring that turns while a requested play is held until the run is ready. */
export function PlaySpinner({ className }: { className?: string }) {
  return <span className={cn('play-spinner', className)} aria-hidden="true" data-testid="play-spinner" />;
}

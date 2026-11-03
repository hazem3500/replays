import type { ComponentPropsWithoutRef } from 'react';

import { useEntryMotion, type EntryMotionKind } from '../hooks/use-entry-motion.ts';

/** A keyed transient label; the final text remains the only accessible content throughout its entry. */
export function MotionLabel({ kind = 'text', ...props }: ComponentPropsWithoutRef<'span'> & { kind?: Exclude<EntryMotionKind, 'error'> }) {
  const ref = useEntryMotion<HTMLSpanElement>(kind);
  return <span ref={ref} {...props} />;
}

/** An inline error with cancellable Motion feedback and unchanged alert semantics. */
export function MotionError(props: ComponentPropsWithoutRef<'p'>) {
  const ref = useEntryMotion<HTMLParagraphElement>('error');
  return <p ref={ref} {...props} />;
}

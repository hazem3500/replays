import type { ComponentProps } from 'react';
import { nounFor } from '../plural.ts';

import { AnimatedNumber } from '@/components/animated-number.tsx';
import { cn } from '@/lib/utils.ts';

/**
 * A count beside a label. Alone it is a quiet tabular number; with `total` it is a small pill reading
 * "reached/total" ("1/7"): the reached number rolls when it changes (AnimatedNumber) in secondary ink, "/7" in
 * tertiary. Neutral always (errors are details, read in the rows). The pill is hidden from screen readers;
 * its owner carries the words (see countLabel). `hideZero` renders nothing when there is nothing to count.
 */
export function Count({
  value,
  total,
  hideZero = false,
  className,
  ...props
}: { value: number; total?: number; hideZero?: boolean } & Omit<ComponentProps<'span'>, 'children'>) {
  if (hideZero && (total ?? value) === 0) return null;
  if (total === undefined) {
    return (
      <span data-slot="count" className={cn('count', className)} {...props}>
        {value}
      </span>
    );
  }
  return (
    // Decorative: the owner names it in full (countLabel), e.g. the tab "Console, 1 of 7 entries reached".
    <span data-slot="count" data-pill="" aria-hidden="true" className={cn('count count-pill', className)} {...props}>
      <AnimatedNumber value={value} className="count-reached" />
      <span className="count-total">/{total}</span>
    </span>
  );
}

/** The words for a reached/total pill, for its owner's accessible name: ", 1 of 7 entries reached". */
export function countLabel(value: number, total: number, singular: string, pluralForm = `${singular}s`) {
  return total > 0 ? `, ${value} of ${total} ${nounFor(total, singular, pluralForm)} reached` : '';
}

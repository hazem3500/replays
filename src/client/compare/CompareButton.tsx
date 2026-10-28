import { Columns2Icon, PlusIcon } from 'lucide-react';

import { Hint } from '@/components/icon-button.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';
import { cn } from '@/lib/utils.ts';

const COMPARE_STRINGS = {
  compare: 'Compare',
  compareHint: 'Compare with another recording, side by side on one timeline',
  add: 'Add a recording',
  addHint: 'Add another recording to the comparison',
} as const;

/**
 * The viewer's own way in to comparing, in its top bar: "Compare" on a replay on its own, "Add a recording" while
 * comparing. Phones show the icon alone, with the name for screen readers.
 */
export function CompareButton({ comparing, compact, onClick }: { comparing: boolean; compact: boolean; onClick: () => void }) {
  const label = comparing ? COMPARE_STRINGS.add : COMPARE_STRINGS.compare;
  const iconOnly = compact || comparing;
  return (
    <Hint label={comparing ? COMPARE_STRINGS.addHint : COMPARE_STRINGS.compareHint} side="bottom" align="end">
      <button
        type="button"
        className={cn(
          buttonVariants({ variant: iconOnly ? 'ghost' : 'outline', size: iconOnly ? 'icon' : 'sm' }),
          'compare-entry text-[var(--text-secondary)] hover:text-foreground [&_svg:not([class*=size-])]:size-4',
        )}
        aria-label={iconOnly ? label : undefined}
        data-testid="compare-with"
        onClick={onClick}
      >
        {comparing ? <PlusIcon aria-hidden="true" /> : <Columns2Icon aria-hidden="true" />}
        {iconOnly ? null : label}
      </button>
    </Hint>
  );
}

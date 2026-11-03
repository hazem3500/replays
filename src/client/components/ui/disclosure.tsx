import { type ReactNode, useState } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible.tsx';
import { cn } from '@/lib/utils.ts';

import { useTransformMotion } from '../../hooks/use-transform-motion.ts';
// oxlint-disable-next-line import/no-unassigned-import -- why: the disclosure's styles ship with the primitive.
import './disclosure.css';

/**
 * A quiet "show more" row: a chevron that turns to point at what it opened, then the folded content. One look for
 * raw error details, advanced settings and optional help, in place of the browser's own `<details>` triangle.
 */
export function Disclosure({
  summary,
  children,
  className,
  panelClassName,
  testId,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  panelClassName?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const chevron = useTransformMotion(`rotate(${open ? 90 : 0}deg)`);
  return (
    <Collapsible className={cn('ui-disclosure', className)} open={open} onOpenChange={setOpen} data-testid={testId}>
      <CollapsibleTrigger className="ui-disclosure-trigger">
        <span ref={chevron} className="ui-disclosure-chevron" aria-hidden="true">
          <AnimatedIcon name="chevron-right" />
        </span>
        {summary}
      </CollapsibleTrigger>
      {/* why: like `<details>`, the folded content stays in the page (hidden), so its data loads and find-in-page reaches it. */}
      <CollapsibleContent hiddenUntilFound className={cn('ui-disclosure-panel', panelClassName)}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

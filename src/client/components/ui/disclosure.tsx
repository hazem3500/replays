import type { ReactNode } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { cn } from '@/lib/utils.ts';

// oxlint-disable-next-line import/no-unassigned-import -- why: the disclosure's styles ship with the primitive.
import './disclosure.css';

/**
 * A quiet "show more" row on the native `<details>`: a chevron that turns to point at what it opened, then the folded
 * content, which stays in the page so its data loads and find-in-page reaches it. One look for advanced settings and
 * optional help in place of the browser's own triangle; the error page's details draw the same chevron in CSS
 * (state-view.css) so the entry chunk does not carry the icon runtime.
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
  return (
    <details className={cn('ui-disclosure', className)} data-testid={testId}>
      <summary className="ui-disclosure-trigger">
        <AnimatedIcon name="chevron-right" className="ui-disclosure-chevron" />
        {summary}
      </summary>
      <div className={cn('ui-disclosure-panel', panelClassName)}>{children}</div>
    </details>
  );
}

import type { ReactNode } from 'react';

import { useIconSwap } from '../hooks/use-icon-swap.ts';

export function IconSwap({ state, children }: { state: 'a' | 'b'; children: ReactNode }) {
  const ref = useIconSwap(state);
  return (
    <span ref={ref} className="icon-swap" data-state={state} aria-hidden="true">
      {children}
    </span>
  );
}

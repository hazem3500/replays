import type { ReactNode } from 'react';

import { useTopbarIdentityMotion } from '../hooks/use-topbar-identity-motion.ts';
// oxlint-disable-next-line import/no-unassigned-import -- why: the identity's flex boundary keeps toolbar actions outside its transition.
import './topbar-identity.css';

/** One transition boundary for the title and its status; toolbar actions stay mounted outside it. */
export function TopbarIdentity({ title, from, children }: { title: string; from?: string | undefined; children?: ReactNode }) {
  const ref = useTopbarIdentityMotion(from, title);
  return (
    <div ref={ref} className="topbar-identity" data-topbar-identity="">
      {children}
    </div>
  );
}

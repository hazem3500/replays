import type { ReactNode } from 'react';
/** Inline Sonner-style toast shell; no global toaster or app styles required. */
export function Toast({ children }: { children: ReactNode }) {
  return (
    <div className="fixed right-4 bottom-4 z-50 max-w-[calc(100vw-2rem)] space-y-2 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg">
      {children}
    </div>
  );
}

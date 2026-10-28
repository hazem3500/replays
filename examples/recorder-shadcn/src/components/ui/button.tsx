import type { ComponentProps } from 'react';
/** Copy-owned shadcn-style primitive: replace classes to match your app. */
export function Button({ className = '', ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={`rounded-md border border-border px-3 py-2 text-sm font-medium shadow-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}

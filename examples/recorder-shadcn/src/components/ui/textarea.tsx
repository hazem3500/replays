import type { ComponentProps } from 'react';
export function Textarea(props: ComponentProps<'textarea'>) {
  return (
    <textarea
      className="min-h-20 w-full rounded-md border border-input bg-transparent p-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
      {...props}
    />
  );
}

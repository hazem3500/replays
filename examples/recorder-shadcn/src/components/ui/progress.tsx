export function Progress({ value }: { value?: number | undefined }) {
  return <progress aria-label="Sending recording" max={1} value={value} className="h-1 w-full accent-primary" />;
}

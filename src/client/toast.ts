import { toast } from 'sonner';

export type ToastTone = 'success' | 'info' | 'error';

/** Messages that report a failure (red icon, longer on screen) or a non-event (muted info). */
function toneOf(message: string): ToastTone {
  if (/^(could not|couldn’t|failed)|failed\b/i.test(message)) return 'error';
  if (/^no /i.test(message)) return 'info';
  return 'success';
}

/** One transient notice through the app's Sonner toaster; errors stay ~6 s, everything else ~3 s. */
export function notify(message: string, tone: ToastTone = toneOf(message), description?: string) {
  const extra = description ? { description } : {};
  if (tone === 'error') toast.error(message, { duration: 6000, ...extra });
  else if (tone === 'info') toast.info(message, extra);
  else toast.success(message, extra);
}

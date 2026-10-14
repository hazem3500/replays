import { CheckIcon, CircleXIcon, InfoIcon } from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

import { useThemeControls } from '../../theme.tsx';

/**
 * The app's one toaster (Sonner, MIT), styled with our tokens: a raised surface, a hairline, the pop shadow,
 * 13 px Inter and 14 px lucide icons (red only for real failures). Bottom centre, clear of the transport;
 * up to three, expanding on hover; swipe to dismiss. Motion is re-timed in tailwind.css.
 */
function Toaster(props: ToasterProps) {
  const { theme } = useThemeControls();
  return (
    <Sonner
      theme={theme}
      position="bottom-center"
      visibleToasts={3}
      duration={3000}
      gap={8}
      offset={{ bottom: 'var(--toast-offset, 72px)' }}
      // Phones: the viewer sets --toast-offset-mobile to just above its transport (Viewer.tsx); elsewhere 64 px plus
      // the home indicator's safe area. Swipe down or sideways to dismiss.
      mobileOffset={{ bottom: 'var(--toast-offset-mobile, calc(64px + env(safe-area-inset-bottom, 0px)))' }}
      swipeDirections={['bottom', 'left', 'right']}
      icons={{
        success: <CheckIcon className="size-3.5 text-[var(--success)]" aria-hidden="true" />,
        info: <InfoIcon className="size-3.5 text-[var(--text-tertiary)]" aria-hidden="true" />,
        error: <CircleXIcon className="size-3.5 text-[var(--danger)]" aria-hidden="true" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: 'app-toast',
          title: 'app-toast-title',
          description: 'app-toast-description',
          actionButton: 'app-toast-action',
          icon: 'app-toast-icon',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };

import { useEffect, useState } from 'react';

/** Keeps a popover in the fullscreen top layer and returns focus before changing its portal. */
export function useFullscreenPopover() {
  const [open, setOpen] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement>();
  useEffect(() => {
    const update = () => {
      setOpen(false);
      setPortalContainer(document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : undefined);
    };
    update();
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  return { open, setOpen, portalContainer };
}

import type { ReactNode } from 'react';
import { IconButton } from '@/components/icon-button.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';
import { cn } from '@/lib/utils.ts';

/** Shared DOM frame for the replay header; behavior and actions stay with the owning page. */
export function ViewerTopbarFrame({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return <header className={`topbar app-topbar${compact ? ' topbar-compact' : ''}`}>{children}</header>;
}

/** Shared title element; the ready title supplies its tooltip/animation inside the same h1 as the loading title. */
export function ViewerPageTitle({
  children,
  id,
  root = false,
  className = '',
}: {
  children: ReactNode;
  id?: string | undefined;
  root?: boolean;
  className?: string;
}) {
  return (
    <h1 id={id} className={`topbar-title${root ? ' topbar-root' : ''}${className ? ` ${className}` : ''}`}>
      {children}
    </h1>
  );
}

/** Shared back-link control for viewer loading and ready headers. */
export function ViewerBackLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'topbar-back [&_svg:not([class*=size-])]:size-4')}
      aria-label={label}
    >
      {children}
    </a>
  );
}

/** Shared transport frame. Loading callers may pass disabled controls while the player chunk is unavailable. */
export function ViewerTransportFrame({ children }: { children: ReactNode }) {
  return (
    <div className="transport" role="group" aria-label="Playback controls">
      {children}
    </div>
  );
}

/** Same accessible play control in both states; the loading shell keeps it disabled until a player exists. */
export function ViewerPlayButton({
  label,
  shortcut,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <IconButton
      label={label}
      {...(shortcut ? { shortcut } : {})}
      tooltipAlign="start"
      className="play-button text-foreground"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </IconButton>
  );
}

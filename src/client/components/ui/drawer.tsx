import { SurfaceMotion } from './surface-motion.tsx';
import * as React from 'react';
import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer';
import { cn } from '@/lib/utils.ts';

/**
 * A bottom sheet (Base UI Drawer): slides up from the bottom edge, swipes down to dismiss,
 * keeps the keyboard inside while open and returns it to the trigger. Motion is transform/opacity only,
 * owned by Motion; reduced motion changes state immediately. Swipe geometry remains controlled by Base UI.
 */
function Drawer({ ...props }: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerTrigger({ ...props }: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerClose({ ...props }: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

/**
 * `scrim={false}` is for a non-modal sheet (`modal={false}` on the root): no backdrop, and the page under it keeps
 * taking taps everywhere outside the sheet. `container` mounts it inside a page element, so that page's styles reach it.
 */
function DrawerContent({
  className,
  children,
  scrim = true,
  container,
  ...props
}: DrawerPrimitive.Popup.Props & { scrim?: boolean; container?: DrawerPrimitive.Portal.Props['container'] }) {
  return (
    <DrawerPrimitive.Portal container={container}>
      {scrim ? (
        <DrawerPrimitive.Backdrop
          render={(dom, state) => <SurfaceMotion {...dom} open={state.open} kind="drawer-backdrop" />}
          data-slot="drawer-overlay"
          className="fixed inset-0 z-50 min-h-dvh bg-(--scrim) opacity-[calc(1-var(--drawer-swipe-progress,0))]"
        />
      ) : null}
      <DrawerPrimitive.Viewport
        data-slot="drawer-viewport"
        className={cn('fixed inset-0 z-50 flex items-end justify-center', !scrim && 'pointer-events-none [&>*]:pointer-events-auto')}
      >
        <DrawerPrimitive.Popup
          render={(dom, state) => <SurfaceMotion {...dom} open={state.open} kind="drawer" />}
          data-slot="drawer-content"
          className={cn(
            // why: the bleed keeps the surface under a finger when the sheet overshoots upward.
            '[--bleed:48px] -mb-(--bleed) box-border flex max-h-[calc(85dvh+var(--bleed))] w-full max-w-[520px] flex-col overflow-y-auto overscroll-contain rounded-t-xl border-t border-(--line-strong) bg-(--surface-raised) px-[16px] pt-[8px] pb-[calc(16px+env(safe-area-inset-bottom,0px)+var(--bleed))] text-(--text) outline-none [transform:translateY(var(--drawer-swipe-movement-y,0px))] data-swiping:select-none',
            className,
          )}
          {...props}
        >
          <div
            data-slot="drawer-handle"
            aria-hidden="true"
            className="mx-auto mb-[8px] h-[4px] w-[36px] shrink-0 rounded-full bg-(--line-strong)"
          />
          <DrawerPrimitive.Content className="min-h-0">{children}</DrawerPrimitive.Content>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPrimitive.Portal>
  );
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return <DrawerPrimitive.Title data-slot="drawer-title" className={cn('m-0 text-[15px] font-semibold', className)} {...props} />;
}

function DrawerFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="drawer-footer" className={cn('flex items-center gap-2', className)} {...props} />;
}

export { Drawer, DrawerClose, DrawerContent, DrawerFooter, DrawerTitle, DrawerTrigger };

import { createContext, use, type ReactNode } from 'react';

import type { SlotDescriptor } from './slots.ts';
import { PluginMount, usePluginSnapshot } from './PluginUi.tsx';
import { resolveSlot } from './registry.ts';
import type { HostSurfaceContext, HostSurfaceDefinition } from './surface-contracts.ts';

export type SurfaceContent = ReactNode | HostSurfaceDefinition;
export const HostSurfaceContextProvider = createContext<HostSurfaceContext>({});
const NO_BUILTINS: readonly SlotDescriptor<HostSurfaceContext, SurfaceContent>[] = [];

/** DOM contributions and core React content share ordering without exposing React in the plugin contract. */
export function isHostSurface(value: unknown): value is HostSurfaceDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    'label' in value &&
    typeof value.label === 'string' &&
    'render' in value &&
    typeof value.render === 'function'
  );
}

export function SurfaceContentView({ value, context }: { value: SurfaceContent; context: HostSurfaceContext }) {
  if (isHostSurface(value))
    return <PluginMount render={(container, current) => value.render(container, current)} context={context} label={value.label} />;
  return value;
}

/** Failing descriptor factories cannot prevent the remaining host surfaces from rendering. */
export function surfaceValue<C, R>(item: SlotDescriptor<C, R>, context: C): R | null {
  try {
    return item.render(context);
  } catch (error) {
    console.error(`slot item ${item.id} failed:`, error);
    return null;
  }
}

/** The caller's core items participate in the same hide, order and policy checks as host additions. */
export function HostSurfaceSlot({
  slot,
  context,
  builtins = NO_BUILTINS,
  element: Element = 'span',
}: {
  slot: string;
  context?: HostSurfaceContext;
  builtins?: readonly SlotDescriptor<HostSurfaceContext, SurfaceContent>[];
  element?: 'span' | 'div' | 'li';
}) {
  usePluginSnapshot();
  const inherited = use(HostSurfaceContextProvider);
  const current = { ...inherited, ...context };
  return resolveSlot(slot, builtins, current).map((item) => (
    <Element key={item.id} data-slot={slot} data-slot-item={item.id} className={Element === 'span' ? 'contents' : undefined}>
      <SurfaceContentView value={surfaceValue(item, current)} context={current} />
    </Element>
  ));
}

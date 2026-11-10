import { PanelSkeleton } from './PanelSkeletons.tsx';

/**
 * An inspector panel before its rows can render (the page transition is still running, or its code is loading): the
 * panel's own layout as a skeleton, so nothing moves when the rows arrive. Never an empty panel.
 */
export function PanelPending({ panel }: { panel: string }) {
  return <PanelSkeleton key={panel} panel={panel} />;
}

import { PanelRightOpenIcon } from 'lucide-react';

import { cn } from '@/lib/utils.ts';

import { useSplitter, type SplitterConfig } from '../../hooks/use-splitter.ts';
import './splitter.css';

export { readSplitterSize, useSplitter, type SplitterConfig } from '../../hooks/use-splitter.ts';

/**
 * The seam between two resizable panels: a hairline at rest with a generous invisible hit area; on hover (fine
 * pointers, after a short delay), focus and drag it turns into a 2 px accent line with a grip at its midpoint.
 * Behaviour lives in useSplitter (hooks/use-splitter.ts); the panels size themselves from `onPreview`/`onChange`.
 */
export function Splitter({ className, testId, ...config }: SplitterConfig & { className?: string; testId?: string }) {
  const { separatorProps } = useSplitter(config);
  return (
    <div {...separatorProps} className={cn('splitter', className)} data-slot="splitter" data-testid={testId}>
      <span className="splitter-line" aria-hidden="true" />
      <span className="splitter-grip" aria-hidden="true" />
    </div>
  );
}

/** Brings a folded side panel back: a small labelled tab on the edge the panel folded into. */
export function SplitterEdgeTab({ label, onOpen, className }: { label: string; onOpen: () => void; className?: string }) {
  return (
    <button type="button" className={cn('splitter-edge-tab', className)} aria-label={label} title={label} onClick={onOpen}>
      <PanelRightOpenIcon aria-hidden="true" />
      <span className="splitter-edge-label">{label}</span>
    </button>
  );
}

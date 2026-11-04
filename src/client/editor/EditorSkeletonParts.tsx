import {
  ChevronDownIcon,
  DownloadIcon,
  FilmIcon,
  HourglassIcon,
  MapPinIcon,
  PlayIcon,
  PlusIcon,
  Redo2Icon,
  ScissorsIcon,
  Undo2Icon,
} from 'lucide-react';

import { Button } from '@/components/ui/button.tsx';
import { formatClock } from '../../shared/replay.ts';

/** The top bar's editing actions, drawn where the editor puts them and disabled until it arrives. */
export function TopbarActionsSkeleton() {
  return (
    <>
      <div className="editor-history" aria-hidden="true">
        <Button variant="ghost" size="icon" disabled tabIndex={-1}>
          <Undo2Icon aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon" disabled tabIndex={-1}>
          <Redo2Icon aria-hidden="true" />
        </Button>
      </div>
      <Button size="sm" className="editor-export" disabled tabIndex={-1} aria-hidden="true">
        <DownloadIcon aria-hidden="true" /> Export
      </Button>
    </>
  );
}

/** Whole seconds across the recording, at most a dozen labels, for the loading ruler. */
function ticks(duration: number) {
  const seconds = Math.floor(duration / 1000);
  const step = Math.max(1, Math.ceil(seconds / 12));
  const out: number[] = [];
  for (let at = 0; at <= seconds; at += step) out.push(at * 1000);
  return out;
}

/**
 * The dock while the editor loads: the transport and tool row disabled, the ruler with the recording's real times
 * when its length is known, and the clip lane with its name, all at the loaded dock's rects.
 */
export function DockSkeleton({ duration }: { duration: number | undefined }) {
  return (
    <section className="editor-dock" aria-hidden="true">
      <div className="editor-bar editor-loading-bar">
        <span className="editor-loading-tool">
          <PlayIcon />
        </span>
        <span className="editor-clock">0:00.0</span>
        <span className="editor-bar-divider" />
        <span className="editor-loading-tool">
          <ScissorsIcon />
        </span>
        <span className="editor-loading-tool">
          <HourglassIcon />
        </span>
        <span className="editor-loading-tool">
          <MapPinIcon />
        </span>
        <span className="editor-bar-divider" />
        <span className="editor-loading-add">
          <PlusIcon /> Add <ChevronDownIcon />
        </span>
        <span className="editor-bar-end">
          {duration === undefined ? null : <span className="editor-durations">{formatClock(duration)}</span>}
        </span>
      </div>
      <div className="editor-loading-timeline">
        <div className="editor-loading-ruler">
          {duration
            ? ticks(duration).map((at) => (
                <span key={at} style={{ left: `${(at / duration) * 100}%` }}>
                  {formatClock(at).replace(/\.\d$/, '')}
                </span>
              ))
            : null}
        </div>
        <div className="editor-loading-lane">
          <span className="editor-loading-gutter">
            <FilmIcon />
          </span>
          <span className="editor-loading-track">
            <span className="editor-loading-clip" />
          </span>
        </div>
      </div>
    </section>
  );
}

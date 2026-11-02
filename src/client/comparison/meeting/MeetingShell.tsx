import { PlayIcon } from 'lucide-react';
import { type CSSProperties, useRef } from 'react';

import { indexReturnHref } from '../../route.ts';
import { Topbar } from '../../Topbar.tsx';
import { useElementSize } from '../../hooks/use-element-size.ts';
import { gridRects } from './layout.ts';
import { tileLetter } from './tiles.ts';
import { MAX_TILES, parseMeetingSearch } from './url.ts';
import '../../loading.css';
import './meeting.css';

export const SHELL_STRINGS = {
  title: 'Loading recordings',
  prefix: 'Compare',
  stand: 'Recording title stand-in',
  play: 'Play all recordings',
} as const;

/** How many tiles the URL asks for, so the shell draws the same grid the meeting view will. */
export function shellCount(search = typeof location === 'undefined' ? '' : location.search) {
  const parsed = parseMeetingSearch(Object.fromEntries(new URLSearchParams(search)));
  return Math.min(MAX_TILES, Math.max(2, parsed.ids?.length ?? 2));
}

/**
 * The meeting view before its code or recordings arrive: the real top bar, calm tiles where the players will be,
 * and a disabled transport. Stand-in text is redacted, never hand-drawn bars.
 */
export function MeetingShell({ count = shellCount() }: { count?: number }) {
  const measure = useRef<HTMLDivElement>(null);
  const box = useElementSize(measure);
  const rects = box.width > 0 ? gridRects(count, box, 16 / 10) : [];
  return (
    <main className="mt-workspace mt-shell" aria-busy="true" aria-label={SHELL_STRINGS.title}>
      <Topbar title={SHELL_STRINGS.title} prefix={SHELL_STRINGS.prefix} backHref={indexReturnHref()} />
      <div ref={measure} className="mt-stage-area pending" data-layout="grid">
        {rects.map((rect, index) => (
          <section
            key={index}
            className="mt-tile"
            data-state="loading"
            style={
              {
                transform: `translate(${rect.x}px, ${rect.y}px)`,
                width: rect.width,
                height: rect.height,
                '--tile': `var(--tile-${(index % 9) + 1})`,
              } as CSSProperties
            }
          >
            <div className="mt-player mt-player-pending" />
            <footer className="mt-nametag">
              <span className="mt-letter" aria-hidden="true">
                {tileLetter(index)}
              </span>
              <span className="mt-label redact">{SHELL_STRINGS.stand}</span>
            </footer>
          </section>
        ))}
      </div>
      <section className="mt-transport" aria-hidden="true">
        <div className="mt-transport-row">
          <button type="button" className="mt-action" disabled aria-label={SHELL_STRINGS.play}>
            <PlayIcon aria-hidden="true" />
          </button>
          <output className="mt-readout">0:00.0 / 0:00.0</output>
        </div>
        <div className="mt-scrubber">
          <input className="mt-range" type="range" disabled tabIndex={-1} defaultValue={0} />
        </div>
      </section>
    </main>
  );
}

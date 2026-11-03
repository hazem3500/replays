import { useRef } from 'react';
import { useViewerPresenceMotion } from '../../hooks/use-viewer-presence-motion.ts';
import { CopyButton } from '@/components/copy-button.tsx';

const STRINGS = {
  none: 'None retained',
  copy: (title: string) => `Copy ${title.toLowerCase()}`,
};

/** A request's or response's retained headers (already redacted at capture), name and value, with a copy action. */
export function HeaderList({ title, rows }: { title: string; rows: ReadonlyArray<{ name: string; value: string }> }) {
  const section = useRef<HTMLElement>(null);
  useViewerPresenceMotion(section, 'network');
  const text = rows.map((row) => `${row.name}: ${row.value}`).join('\n');
  return (
    <section ref={section} className="np-section">
      <h3>
        {title}
        {rows.length ? <span className="np-aside">{rows.length}</span> : null}
        {rows.length ? <CopyButton value={text} label={STRINGS.copy(title)} className="np-copy" /> : null}
      </h3>
      {rows.length ? (
        <dl className="np-header-list">
          {rows.map((row) => (
            <div key={`${row.name}:${row.value}`}>
              <dt>{row.name}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="np-aside">{STRINGS.none}</p>
      )}
    </section>
  );
}

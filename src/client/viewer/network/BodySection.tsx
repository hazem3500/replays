import { useViewerPresenceMotion } from '../../hooks/use-viewer-presence-motion.ts';
import { useRef, useState } from 'react';

import type { ReplayCaptured, ReplayNetworkBody } from '../../../shared/replay.ts';
import { CopyButton } from '@/components/copy-button.tsx';
import { formatBytes } from '../../format.ts';
import { bodyState, bodyView, redactionParts } from './body.ts';

/** Longer bodies start folded to this many lines (network.css matches it), with a way to show the rest. */
const FOLDED_LINES = 14;

const STRINGS = {
  copy: (title: string) => `Copy ${title.toLowerCase()}`,
  showAll: (lines: number) => `Show all ${lines} lines`,
  showLess: 'Show less',
  truncated: (kept: number, size: number | undefined) => `Truncated at ${formatBytes(kept)}${size ? ` of ${formatBytes(size)}` : ''}`,
  size: (size: number) => formatBytes(size),
  empty: 'No body',
  omittedType: 'Not kept: only JSON, text and form bodies are captured',
  omittedUnavailable: 'Not available: the browser did not expose this body',
  notCaptured: 'Not captured: this recording kept headers only',
  redacted: 'Redacted before it was stored',
};

/**
 * A request or response body in the request detail: indented JSON or decoded form fields, folded when long, with copy,
 * a note when it was truncated, and redaction markers drawn as such. When there is no text it says why.
 */
export function BodySection({
  title,
  body,
  mimeType,
  captured,
}: {
  title: string;
  body: ReplayNetworkBody | undefined;
  mimeType: string | undefined;
  captured: ReplayCaptured | undefined;
}) {
  const section = useRef<HTMLElement>(null);
  useViewerPresenceMotion(section, 'network');
  const state = bodyState(body, captured);
  return (
    <section ref={section} className="np-section np-body-section" data-state={state.kind}>
      <h3>
        {title}
        {state.kind === 'shown' && state.body.size ? <span className="np-aside">{STRINGS.size(state.body.size)}</span> : null}
        {state.kind === 'shown' ? <CopyButton value={state.body.text} label={STRINGS.copy(title)} className="np-copy" /> : null}
      </h3>
      {state.kind === 'shown' ? (
        <BodyText text={state.body.text} mimeType={mimeType} truncated={state.body.truncated === true} size={state.body.size} />
      ) : null}
      {state.kind === 'empty' ? <p className="np-aside">{STRINGS.empty}</p> : null}
      {state.kind === 'omitted' ? (
        <p className="np-aside">{state.reason === 'content-type' ? STRINGS.omittedType : STRINGS.omittedUnavailable}</p>
      ) : null}
      {state.kind === 'not-captured' ? <p className="np-aside">{STRINGS.notCaptured}</p> : null}
    </section>
  );
}

function BodyText({
  text,
  mimeType,
  truncated,
  size,
}: {
  text: string;
  mimeType: string | undefined;
  truncated: boolean;
  size: number | undefined;
}) {
  const [open, setOpen] = useState(false);
  const view = bodyView(text, mimeType);
  const folds = view.lines > FOLDED_LINES;
  return (
    <>
      <pre className="np-body-text" data-kind={view.kind} data-folded={(folds && !open) || undefined}>
        {redactionParts(view.text).map((part, index) =>
          part.redacted ? (
            // oxlint-disable-next-line react/no-array-index-key -- why: parts are positional slices of one fixed text.
            <mark key={index} className="np-redacted" title={STRINGS.redacted}>
              {part.text}
            </mark>
          ) : (
            // oxlint-disable-next-line react/no-array-index-key -- why: parts are positional slices of one fixed text.
            <span key={index}>{part.text}</span>
          ),
        )}
      </pre>
      {folds ? (
        <button type="button" className="np-body-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? STRINGS.showLess : STRINGS.showAll(view.lines)}
        </button>
      ) : null}
      {truncated ? <p className="np-body-note">{STRINGS.truncated(new TextEncoder().encode(text).length, size)}</p> : null}
    </>
  );
}

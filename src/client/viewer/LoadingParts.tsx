import { useState } from 'react';

import { AnimatedIcon, type AnimatedIconName } from '@/components/animated-icon.tsx';
import { IconButton } from '@/components/icon-button.tsx';
import { Button } from '@/components/ui/button.tsx';

import { formatClock, type ReplayBundle, type ReplayStep } from '../../shared/replay.ts';
import { PLAYBACK_SPEEDS } from '../../shared/render-variant.ts';
import { editingEnabled } from '../config.ts';
import { useDelayedFlag } from '../hooks/use-delayed-flag.ts';
import { useLoadProgress } from '../load-progress.ts';
import { ThemeSwitch } from '../theme.tsx';
import { PanelPending } from './PanelPending.tsx';
import { ViewerPlayButton, ViewerTransportFrame } from './presentation.tsx';
import '../loading.css';
import './scrubber.css';
import './viewer-loading.css';

/* why: one module for every loading layout of the replay page (ProgressiveViewerShell, ViewerSkeleton, the suite and
 * editor skeletons), so they share the rule: the page's real chrome at once, stand-ins only for unknown data, and a
 * per-region hand-over to the ready page (useShellHandover, viewer-loading.css).
 */
/* oxlint-disable jsx-a11y/control-has-associated-label -- why: the loading tables are aria-hidden copies of the panel's table; the ready table carries the labels. */

/** The rate whose label is widest in tabular figures; it sizes the speed button (as Transport.tsx does). */
const WIDEST_SPEED = PLAYBACK_SPEEDS.reduce<number>(
  (widest, speed) => (String(speed).length > String(widest).length ? speed : widest),
  1,
);

/** The viewer's action icons in their places, disabled until the replay is there to act on. */
export function LoadingTopbarActions({ compact = false }: { compact?: boolean }) {
  return (
    <div className="topbar-actions loading-actions">
      {editingEnabled() ? <DisabledIcon label="Edit replay" icon="pencil" /> : null}
      <DisabledIcon label="Replay details" icon="info" />
      <DisabledIcon label="Copy link" icon="link" />
      {compact ? null : <DisabledIcon label="Download video" icon="download" />}
      {compact ? null : <ThemeSwitch />}
      <DisabledIcon label="More actions" icon="ellipsis" className="topbar-more" />
    </div>
  );
}

function DisabledIcon({ label, icon, className }: { label: string; icon: AnimatedIconName; className?: string }) {
  return (
    <IconButton label={label} disabled {...(className ? { className } : {})}>
      <AnimatedIcon name={icon} />
    </IconButton>
  );
}

/** The transport as it will be, inert: nothing moves into place when the player arrives. */
export function LoadingTransport({ steps }: { steps: number }) {
  return (
    <ViewerTransportFrame>
      <ViewerPlayButton label="Play" disabled>
        <span className="icon-swap" data-state="a" aria-hidden="true">
          <AnimatedIcon name="play" className="icon-a filled-icon" />
        </span>
      </ViewerPlayButton>
      <span className="transport-time">
        <strong>{formatClock(0)}</strong>
      </span>
      <div className="scrubber loading-scrubber" aria-hidden="true">
        <div className="scrubber-rail">
          <div className="scrubber-bars">
            <div className="scrubber-segment" style={{ left: 0, right: 0 }}>
              <LoadedFill />
            </div>
          </div>
        </div>
      </div>
      {steps > 0 ? (
        <IconButton label="Show step captions" disabled className="captions-switch h-7 min-w-7 px-0">
          <span className="captions-chip" aria-hidden="true">
            <AnimatedIcon name="captions" />
          </span>
        </IconButton>
      ) : null}
      <Button variant="ghost" size="sm" className="playback-options h-7 rounded-md px-2" disabled aria-label="Playback speed">
        <span className="playback-speed-box">
          <span className="playback-speed-sizer" aria-hidden="true">
            {WIDEST_SPEED}×
          </span>
          <span className="playback-speed">1×</span>
        </span>
      </Button>
    </ViewerTransportFrame>
  );
}

/** The seek track's loaded share (like a video's buffered range), in a quiet tint below the accent. */
function LoadedFill() {
  const share = useLoadShare();
  return <span className="loading-buffered" data-known={share === undefined ? undefined : ''} style={{ transform: `scaleX(${share ?? 0})` }} />;
}

/**
 * The thin accent line along the top bar's foot, after 1.2 s of loading: the downloaded share when the size is known
 * (load-progress.ts), else a short segment gliding across.
 */
export function ProgressHint() {
  const visible = useDelayedFlag(1200);
  const share = useLoadShare();
  return (
    <span className="sk-progress" data-visible={visible || undefined} data-determinate={share === undefined ? undefined : ''} aria-hidden="true">
      <span style={share === undefined ? undefined : { transform: `scaleX(${share})` }} />
    </span>
  );
}

/** Downloaded share of the bundle: a number once the size is known, else undefined (indeterminate). */
export function useLoadShare() {
  const progress = useLoadProgress();
  return progress?.total ? Math.min(1, progress.loaded / progress.total) : undefined;
}

/** The ring's circumference (r = 15 in a 36 × 36 box), for its dash. */
const RING = 2 * Math.PI * 15;

/**
 * The player: the stage and the recording's frame at its aspect ratio (as the viewer fits it), showing the card's
 * poster at full strength under a dark scrim (a calm surface without one), and centred where play will be, a ring
 * that fills with the real download around a play glyph: about to play, not disabled.
 */
export function LoadingPlayer({ poster }: { poster?: string | undefined }) {
  const [failed, setFailed] = useState<string>();
  const share = useLoadShare();
  const shown = poster && failed !== poster ? poster : undefined;
  return (
    <div className="stage-wrap">
      <div className="player-stage sk-stage loading-stage">
        <div className="sk-frame loading-frame" data-poster={shown ? '' : undefined}>
          {shown ? <img className="loading-poster" src={shown} alt="" decoding="async" draggable={false} onError={() => setFailed(shown)} /> : null}
          <span className="loading-ring" data-determinate={share === undefined ? undefined : ''} aria-hidden="true">
            <svg viewBox="0 0 36 36">
              <circle className="loading-ring-track" cx="18" cy="18" r="15" />
              <circle
                className="loading-ring-arc"
                cx="18"
                cy="18"
                r="15"
                strokeDasharray={RING}
                strokeDashoffset={share === undefined ? RING * 0.75 : RING * (1 - share)}
              />
              <path className="loading-ring-play" d="M15 12.5v11l9-5.5z" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Stand-in step labels of natural lengths: only their redacted line boxes ever show. */
const STAND_IN_STEPS = ['Open the checkout page', 'Fill in the email', 'Apply coupon SPRING10', 'Wait for the total', 'Place the order'];

/** How many real rows to draw before the player code arrives: the rail scrolls, so a screenful is plenty. */
const MAX_REAL_ROWS = 24;

/**
 * The step rail's rows, in the rail's own markup (`.step`: kind glyph, label, time). With the bundle: the real
 * labels and times, minus the kind glyphs and the controls (the player code is still on its way). Before it: at
 * most five stand-in rows, redacted to bands on their own line boxes (`.pending`), breathing, fading out downwards.
 */
export function LoadingSteps({ count, steps }: { count: number; steps?: readonly ReplayStep[] | undefined }) {
  if (steps?.length)
    return (
      <div className="timeline loading-real" aria-hidden="true">
        {steps.slice(0, MAX_REAL_ROWS).map((step) => (
          <div key={`${step.at}-${step.label}`} className="step upcoming loading-step">
            <span className="loading-step-kind" />
            <span className="step-copy">
              <strong>{step.label}</strong>
            </span>
            <time>{formatClock(step.at)}</time>
          </div>
        ))}
      </div>
    );
  const rows = Math.max(1, Math.min(count, 5));
  return (
    <div className="timeline pending loading-rows" data-region="steps" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="step upcoming loading-step">
          <span className="loading-step-kind" />
          <span className="step-copy">
            <strong className="redact">{STAND_IN_STEPS[index % STAND_IN_STEPS.length]}</strong>
          </span>
          <time className="redact">{formatClock((index + 1) * 2100)}</time>
        </div>
      ))}
    </div>
  );
}

const CONSOLE_COLUMNS = ['Time', 'Message', 'Source'];

const host = (url: string | undefined) => {
  if (!url) return '—';
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/**
 * The selected panel while the replay loads: with the bundle, the console's real rows (upcoming, as at 0:00);
 * otherwise the panel's own pending state (PanelPending), the same one its lazy code shows while it loads, so
 * nothing changes shape on the way to the ready panel.
 */
export function LoadingPanel({ panel, bundle }: { panel: string; bundle?: Pick<ReplayBundle, 'console'> | undefined }) {
  if (panel === 'console' && bundle?.console.length)
    return (
      <table className="diagnostic-table console-table loading-real" aria-hidden="true">
        <thead>
          <tr>
            {CONSOLE_COLUMNS.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bundle.console.slice(0, MAX_REAL_ROWS).map((entry, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- why: a read-only copy of the first rows, never reordered; messages can repeat at the same instant.
            <tr key={index} className={`console-row ${entry.level}`} data-future="">
              <td>
                <span className="seek-time">
                  <time>{formatClock(entry.at)}</time>
                </span>
              </td>
              <td>
                <span className="console-message">
                  <span className="loading-level" data-level={entry.level} />
                  <code>{entry.message}</code>
                </span>
              </td>
              <td className="source">{host(entry.url)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  return <PanelPending panel={panel} />;
}

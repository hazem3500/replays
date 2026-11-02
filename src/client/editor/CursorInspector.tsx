import { useEffect, useRef, useState } from 'react';
import { XIcon } from 'lucide-react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';

import { Button } from '@/components/ui/button.tsx';
import { IconButton } from '@/components/icon-button.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { Slider, SliderControl, SliderTrack, SliderIndicator, SliderThumb } from '@/components/ui/slider.tsx';
import {
  CURSOR_MOTION_STYLES,
  type CursorMotionStyle,
  DEFAULT_CURSOR_MOTION_STYLE,
  isCursorMotionStyle,
  normalizeCursor,
  type ReplayCursorSettings,
} from '../../shared/cursor.ts';
import { planMove, type Pose, sampleTrajectory } from '../cursor-motion.ts';
import { CursorAppearancePicker } from './CursorAppearancePicker.tsx';
import './cursor-inspector.css';

/** Names and one-line feels, after the CUA Cursor Motion README's style table. */
export const MOTION_OPTIONS: Record<CursorMotionStyle, { label: string; description: string }> = {
  signature_arc: { label: 'Signature arc', description: 'One arc, small follow-through' },
  spring_settle: { label: 'Spring settle', description: 'Lands with a soft bounce' },
  magnetic: { label: 'Magnetic', description: 'Slows, then snaps to target' },
  comet_swoop: { label: 'Comet swoop', description: 'A wide, sweeping arc' },
  adaptive: { label: 'Adaptive', description: 'Direct; swoops on long moves' },
  classic: { label: 'Classic', description: 'Steered glide, springy stop' },
};

/** One canonical move, lower left to upper right, drawn into a 44 × 30 box. */
const PREVIEW = { width: 44, height: 30, pad: 4, from: { x: 0, y: 220 }, to: { x: 320, y: 0 } };
/** The dot's trip is the move's own timing, compressed to at most this, then a short fade. */
const PREVIEW_TRAVEL_MS = 560;
const PREVIEW_FADE_MS = 140;
const PREVIEW_KEYFRAMES = 40;

interface MotionPreview {
  d: string;
  target: { x: number; y: number };
  keyframes: Keyframe[];
  durationMs: number;
}

let previews: Record<CursorMotionStyle, MotionPreview> | undefined;

/** Each style's real trajectory for the canonical move, planned once on first render; all six share one scale. */
function motionPreviews() {
  if (previews) return previews;
  const planned = CURSOR_MOTION_STYLES.map((style) => planMove(PREVIEW.from, PREVIEW.to, { style, seed: 'cursor-inspector' }));
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { samples } of planned) {
    for (let i = 0; i < samples.length; i += 4) {
      minX = Math.min(minX, samples[i + 1] as number);
      maxX = Math.max(maxX, samples[i + 1] as number);
      minY = Math.min(minY, samples[i + 2] as number);
      maxY = Math.max(maxY, samples[i + 2] as number);
    }
  }
  const scale = Math.min((PREVIEW.width - 2 * PREVIEW.pad) / (maxX - minX), (PREVIEW.height - 2 * PREVIEW.pad) / (maxY - minY));
  const ox = (PREVIEW.width - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (PREVIEW.height - (maxY - minY) * scale) / 2 - minY * scale;
  const px = (x: number) => Math.round((ox + x * scale) * 100) / 100;
  const py = (y: number) => Math.round((oy + y * scale) * 100) / 100;
  const pose: Pose = { visible: true, x: 0, y: 0, heading: 0, scale: 1, opacity: 1 };
  const entries = planned.map((traj, index) => {
    const points: string[] = [];
    for (let i = 0; i < traj.samples.length; i += 4)
      points.push(`${px(traj.samples[i + 1] as number)} ${py(traj.samples[i + 2] as number)}`);
    const travel = Math.min(traj.durationMs, PREVIEW_TRAVEL_MS);
    const durationMs = travel + PREVIEW_FADE_MS;
    const keyframes: Keyframe[] = [];
    for (let i = 0; i <= PREVIEW_KEYFRAMES; i++) {
      const f = i / PREVIEW_KEYFRAMES;
      sampleTrajectory(traj, f * traj.durationMs, pose);
      keyframes.push({ offset: (f * travel) / durationMs, opacity: 1, transform: `translate(${px(pose.x)}px, ${py(pose.y)}px)` });
    }
    keyframes.push({ offset: 1, opacity: 0, transform: keyframes.at(-1)?.transform ?? 'none' });
    const style = CURSOR_MOTION_STYLES[index] as CursorMotionStyle;
    return [style, { d: `M${points.join('L')}`, target: { x: px(PREVIEW.to.x), y: py(PREVIEW.to.y) }, keyframes, durationMs }] as const;
  });
  previews = Object.fromEntries(entries) as Record<CursorMotionStyle, MotionPreview>;
  return previews;
}

const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function CursorInspector({
  settings,
  onChange,
  onClose,
  embedded = false,
}: {
  settings: ReplayCursorSettings | undefined;
  onChange: (settings: ReplayCursorSettings | undefined) => void;
  onClose: () => void;
  /** Desktop uses a standing properties panel; mobile retains its transient inspector. */
  embedded?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const savedSize = settings?.size ?? 1;
  const [draft, setDraft] = useState({ saved: savedSize, value: savedSize });
  // Undo, redo and reset replace the saved size; discard a stale drag before painting.
  if (draft.saved !== savedSize) setDraft({ saved: savedSize, value: savedSize });
  const size = draft.saved === savedSize ? draft.value : savedSize;
  useEffect(() => {
    if (!embedded) heading.current?.focus();
  }, [embedded]);
  const visible = settings?.visible !== false;
  const update = (patch: ReplayCursorSettings) => onChange(normalizeCursor({ ...settings, ...patch }));
  const motionStyle = settings?.motionStyle ?? DEFAULT_CURSOR_MOTION_STYLE;
  const dots = useRef(new Map<CursorMotionStyle, SVGCircleElement>());
  /** Runs the row's dot along its path once; a hover leaves a trip already under way alone. */
  const playPreview = (style: CursorMotionStyle, restart: boolean) => {
    const dot = dots.current.get(style);
    if (!dot || typeof dot.animate !== 'function' || prefersReducedMotion()) return;
    const running = dot.getAnimations();
    if (!restart && running.some((animation) => animation.playState === 'running')) return;
    for (const animation of running) animation.cancel();
    const preview = motionPreviews()[style];
    dot.animate(preview.keyframes, { duration: preview.durationMs, easing: 'linear' });
  };

  return (
    // Delegates Escape and shields contained controls from global editor shortcuts.
    // The role is dialog or group, which the lint cannot read through the expression.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-static-element-interactions
    <div
      role={embedded ? 'group' : 'dialog'}
      aria-modal={embedded ? undefined : false}
      className="cursor-inspector"
      id="cursor-inspector"
      aria-labelledby="cursor-heading"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !embedded) {
          event.preventDefault();
          onClose();
        } else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
          // The inspector's switches, radios and slider own their keyboard interaction.
          event.stopPropagation();
        }
      }}
    >
      <header className="cursor-inspector-header">
        <h2 id="cursor-heading" ref={heading} tabIndex={-1}>
          Cursor
        </h2>
        {embedded ? null : (
          <IconButton label="Close cursor options" onClick={onClose}>
            <XIcon aria-hidden="true" />
          </IconButton>
        )}
      </header>
      <div className="cursor-option-row">
        <label htmlFor="cursor-visible">Show cursor</label>
        <Switch id="cursor-visible" checked={visible} onCheckedChange={(checked) => update({ visible: checked })} />
      </div>
      <fieldset disabled={!visible} className="cursor-options">
        <legend className="sr-only">Cursor appearance and behavior</legend>
        <CursorAppearancePicker settings={settings} disabled={!visible} update={update} />
        <div className="cursor-motion">
          <span id="cursor-motion-label" className="cursor-motion-label">
            Motion
          </span>
          <RadioGroup
            aria-labelledby="cursor-motion-label"
            className="cursor-motion-list"
            value={motionStyle}
            disabled={!visible}
            onValueChange={(value) => {
              if (!isCursorMotionStyle(value)) return;
              update({ motionStyle: value });
              playPreview(value, true);
            }}
          >
            {CURSOR_MOTION_STYLES.map((style) => {
              const option = MOTION_OPTIONS[style];
              const preview = motionPreviews()[style];
              return (
                <Radio.Root
                  key={style}
                  value={style}
                  className="cursor-motion-option"
                  data-motion-style={style}
                  aria-labelledby={`cursor-motion-${style}`}
                  aria-describedby={`cursor-motion-${style}-description`}
                  onPointerEnter={(event) => {
                    if (event.pointerType === 'mouse' && visible) playPreview(style, false);
                  }}
                >
                  <svg className="cursor-motion-preview" viewBox={`0 0 ${PREVIEW.width} ${PREVIEW.height}`} aria-hidden="true">
                    <path className="cursor-motion-path" d={preview.d} />
                    <circle className="cursor-motion-target" cx={preview.target.x} cy={preview.target.y} r={1.75} />
                    <circle
                      className="cursor-motion-dot"
                      r={2.5}
                      ref={(node) => {
                        if (node) dots.current.set(style, node);
                        else dots.current.delete(style);
                      }}
                    />
                  </svg>
                  <span className="cursor-motion-text">
                    <span className="cursor-motion-name" id={`cursor-motion-${style}`}>
                      {option.label}
                      {style === DEFAULT_CURSOR_MOTION_STYLE ? (
                        <>
                          {' '}
                          <span className="cursor-motion-tag">Default</span>
                        </>
                      ) : null}
                    </span>
                    <span className="cursor-motion-description" id={`cursor-motion-${style}-description`}>
                      {option.description}
                    </span>
                  </span>
                </Radio.Root>
              );
            })}
          </RadioGroup>
        </div>
        <div className="cursor-option-row">
          <span id="cursor-size-label">Size</span>
          <output>{Math.round(size * 100)}%</output>
        </div>
        <Slider
          value={size}
          min={0.5}
          max={2}
          step={0.05}
          disabled={!visible}
          onValueChange={(value) => setDraft({ saved: savedSize, value })}
          onValueCommitted={(value) => update({ size: Math.round(value * 100) / 100 })}
        >
          <SliderControl>
            <SliderTrack>
              <SliderIndicator />
            </SliderTrack>
            <SliderThumb aria-labelledby="cursor-size-label" getAriaValueText={(value) => `${Math.round(Number(value) * 100)} percent`} />
          </SliderControl>
        </Slider>
        <div className="cursor-option-row cursor-idle-option">
          <label htmlFor="cursor-idle">
            Hide when idle<small>Fade after 1.5 seconds</small>
          </label>
          <Switch
            id="cursor-idle"
            disabled={!visible}
            checked={settings?.hideWhenIdle !== false}
            onCheckedChange={(checked) => update({ hideWhenIdle: checked })}
          />
        </div>
        <div className="cursor-option-row">
          <label htmlFor="cursor-clicks">
            Click feedback<small>Ripple, pulse or press, by style</small>
          </label>
          <Switch
            id="cursor-clicks"
            disabled={!visible}
            checked={settings?.clickFeedback !== false}
            onCheckedChange={(checked) => update({ clickFeedback: checked })}
          />
        </div>
      </fieldset>
      <footer className="cursor-inspector-footer">
        {embedded ? null : <span>Applies to the whole replay</span>}
        <Button variant="ghost" size="sm" disabled={!normalizeCursor(settings)} onClick={() => onChange(undefined)}>
          Reset
        </Button>
      </footer>
    </div>
  );
}

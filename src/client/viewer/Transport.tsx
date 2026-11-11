import { useReplayFirstPaint } from '../hooks/use-replay-first-paint.ts';
import { useTileCoverMotion } from '../hooks/use-tile-cover-motion.ts';
import { IconSwap } from '../components/icon-swap.tsx';
import { PlaySpinner } from '../components/play-spinner.tsx';
import { useStageFlashMotion } from '../hooks/use-stage-flash-motion.ts';
import { MotionLabel } from '../components/entry-motion.tsx';
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { useFullscreenPresence } from '../hooks/use-fullscreen-presence.ts';

import { formatClock } from '../../shared/replay.ts';
import { usePlayer, usePlayerState, usePlayhead, useViewport } from '../player.ts';
import { exportCaptionScale } from '../step-caption.ts';
import { activeStepIndex, fitViewport } from '../timeline.ts';

import { Hint, IconButton } from '@/components/icon-button.tsx';
import { shortcutLabel } from '../shortcuts.ts';
import { Button } from '@/components/ui/button.tsx';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover.tsx';
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from '@/components/ui/slider.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { useViewer } from './context.ts';
import { bandAt, type FrameBand, nearestBand } from './performance/frames.ts';
import { freshPoster } from '../transitions/open-hint.ts';
import { Scrubber } from './Scrubber.tsx';
import { APP_PLAYBACK_SPEEDS } from './playback-speeds.ts';
import { useAppPlaybackSpeed } from '../hooks/use-app-playback-speed.ts';
import { CaptionControls } from './CaptionControls.tsx';
import { useFullscreenPopover } from '../hooks/use-fullscreen-popover.ts';

export { activeStepIndex };

/** How long a click on the stage waits for a second click (double click = fullscreen) before flipping playback. */
const DOUBLE_CLICK_MS = 220;
const NO_FRAMES: readonly FrameBand[] = [];

export function PlayerStage() {
  const player = usePlayer();
  const viewport = useViewport();
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);

  // The recorded frame (`.player-frame`, at the fitted rect) holds rrweb's host and, when opened from a card,
  // that card's poster on top: the page transition morphs the card into this element (transitions/page-motion.ts). A light
  // replay mounts as soon as the morph moves, so the poster hands over to the replay mid-flight; a heavy one
  // waits until it has landed (its mount would stall the animation), then the poster fades over it.
  // Click the picture to play or pause (as in a video player); a double click flips fullscreen instead, so the
  // single click waits DOUBLE_CLICK_MS to be sure. A drag or a text selection on the stage is not a click. Touch: a
  // tap flips too (the phone transport is always shown, so there is no "first tap shows controls" step).
  // Keyboard users have Space/K and the play button, which stays the accessible control.
  const { switchFullscreen } = useViewer();
  const [flash, setFlash] = useState<{ id: number; kind: 'play' | 'pause' }>();
  const pressAt = useRef<{ x: number; y: number } | undefined>(undefined);
  const clickTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(clickTimer.current), []);
  const stageHandlers = {
    onPointerDown: (event: ReactPointerEvent) => {
      pressAt.current = { x: event.clientX, y: event.clientY };
    },
    onClick: (event: ReactMouseEvent) => {
      const start = pressAt.current;
      pressAt.current = undefined;
      if (event.button !== 0 || event.detail > 1) return;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed) return;
      window.clearTimeout(clickTimer.current);
      clickTimer.current = window.setTimeout(() => {
        const willPlay = player.getState().status !== 'playing';
        player.playPause();
        setFlash((current) => ({ id: (current?.id ?? 0) + 1, kind: willPlay ? 'play' : 'pause' }));
      }, DOUBLE_CLICK_MS);
    },
    onDoubleClick: () => {
      window.clearTimeout(clickTimer.current);
      switchFullscreen();
    },
  };
  const [cover] = useState(freshPoster);
  const painted = useReplayFirstPaint(host, player);
  const covering = Boolean(cover) && !painted;
  const coverImage = useTileCoverMotion(painted);
  const frame = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = box.current;
    const target = host.current;
    if (!element || !target) return;
    target.style.width = `${viewport.width}px`;
    target.style.height = `${viewport.height}px`;
    const apply = () => {
      const fit = fitViewport({ width: element.clientWidth, height: element.clientHeight }, viewport, 12);
      target.style.transform = `scale(${fit.scale})`;
      // Overlays inside the replay (the step target outline) keep a constant on-screen stroke.
      target.style.setProperty('--player-scale', String(fit.scale));
      const rect = frame.current;
      if (rect) {
        rect.style.transform = `translate(${fit.x}px, ${fit.y}px)`;
        rect.style.width = `${viewport.width * fit.scale}px`;
        rect.style.height = `${viewport.height * fit.scale}px`;
      }
      // Overlays anchored to the recorded frame (the step caption) read its box from the stage's wrapper.
      const wrap = element.parentElement;
      if (wrap) {
        const width = viewport.width * fit.scale;
        const height = viewport.height * fit.scale;
        wrap.style.setProperty('--frame-x', `${fit.x}px`);
        wrap.style.setProperty('--frame-y', `${fit.y}px`);
        wrap.style.setProperty('--caption-scale', String(exportCaptionScale(viewport.width) * fit.scale));
        wrap.style.setProperty('--frame-w', `${width}px`);
        wrap.style.setProperty('--frame-h', `${height}px`);
        wrap.style.setProperty('--frame-right', `${element.clientWidth - fit.x - width}px`);
        wrap.style.setProperty('--frame-bottom', `${element.clientHeight - fit.y - height}px`);
      }
    };
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    apply();
    return () => observer.disconnect();
  }, [viewport]);

  // The recorded page is a picture of the session, not part of this app: `inert` keeps Tab from walking every
  // link and field the recorded site had (and screen readers from reading it as live UI). The stage itself
  // stays the skip link's target.
  return (
    <div
      ref={box}
      className="player-stage"
      style={{ '--viewport-ratio': `${viewport.width} / ${viewport.height}` } as CSSProperties}
      id="replay-player"
      data-testid="replay-player"
      role="img"
      aria-label="Recorded page at the playhead"
      tabIndex={-1}
      {...stageHandlers}
    >
      <div ref={frame} className="player-frame">
        <div ref={host} className="player-host" inert />
        {cover ? (
          <img
            ref={coverImage}
            className="player-cover"
            src={cover}
            alt=""
            decoding="sync"
            draggable={false}
            data-covering={covering || undefined}
          />
        ) : null}
      </div>
      {flash ? (
        <StageFlash key={flash.id} kind={flash.kind}>
          <svg viewBox="0 0 24 24">
            {flash.kind === 'play' ? <path d="M8 5.5v13l10.5-6.5z" /> : <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />}
          </svg>
        </StageFlash>
      ) : null}
    </div>
  );
}

/**
 * One quiet row, like QuickTime: play, elapsed (the duration in its hint), the
 * scrubber (steps are its chapters), step captions and a
 * "More" menu for speed and skip-inactive. Secondary controls rest at reduced
 * emphasis and come up on hover or keyboard navigation. Narrow players (and fingers) give
 * the scrubber its own row above the controls.
 */
export function Transport() {
  const { steps, errors, editCaptions } = useViewer();
  return (
    <div className="transport" role="group" aria-label="Playback controls">
      <PlayButton />
      <div className="transport-readouts">
        <TimeReadout />
        <FpsReadout />
      </div>
      <Scrubber steps={steps} errors={errors} />
      {steps.length > 0 || editCaptions ? <CaptionControls edited={editCaptions === true} /> : null}
      <PlaybackOptions />
    </div>
  );
}

function StageFlash({ kind, children }: { kind: 'play' | 'pause'; children: ReactNode }) {
  const ref = useStageFlashMotion();
  return (
    <span ref={ref} className="stage-flash" data-kind={kind} aria-hidden="true" data-testid="stage-flash">
      {children}
    </span>
  );
}

function PlayButton() {
  const player = usePlayer();
  const { status, starting } = usePlayerState();
  const label = starting ? 'Cancel play' : status === 'playing' ? 'Pause' : status === 'ended' ? 'Replay from start' : 'Play';
  return (
    <IconButton
      label={label}
      shortcut={shortcutLabel('play-pause')}
      tooltipAlign="start"
      className="play-button text-foreground"
      aria-busy={starting || undefined}
      onClick={() => player.playPause()}
    >
      {starting ? (
        <PlaySpinner />
      ) : (
        <IconSwap state={status === 'playing' ? 'b' : 'a'}>
          {status === 'ended' ? (
            <AnimatedIcon name="rotate-ccw" className="icon-a" />
          ) : (
            <AnimatedIcon name="play" className="icon-a filled-icon" trigger="state" play={status === 'playing' ? false : status} />
          )}
          <AnimatedIcon name="pause" className="icon-b filled-icon" trigger="state" play={status === 'playing' ? 'playing' : false} />
        </IconSwap>
      )}
    </IconButton>
  );
}

function TimeReadout() {
  const player = usePlayer();
  // A string selector: the clock shows tenths, so this renders ~10 times a second, not every frame.
  const clock = usePlayhead((time) => formatClock(time));
  // The total lives in a hint (and in Replay details); the row itself only counts up.
  return (
    <Hint label={`Duration ${formatClock(player.duration)}`} align="start">
      <span className="transport-time" data-testid="elapsed">
        <strong data-testid="playhead">{clock}</strong>
      </span>
    </Hint>
  );
}

function fpsHint(band: FrameBand) {
  return `About ${Math.round(band.fps)} frames per second this second; about ${band.dropped} missed against 60 Hz`;
}

/** Frame rate at the playhead, for performance-focused replays: from the recorded one-second samples, never made up. */
function FpsReadout() {
  const { performanceFocused, frames = NO_FRAMES } = useViewer();
  const band = usePlayhead((time) => bandAt(frames, time) ?? nearestBand(frames, time));
  if (!performanceFocused || !frames.length || !band) return null;
  return (
    <Hint label={fpsHint(band)} align="start">
      <span className="transport-fps" data-testid="fps-readout" data-verdict={band.verdict}>
        <i aria-hidden="true" />
        <strong>{Math.round(band.fps)}</strong> FPS
      </span>
    </Hint>
  );
}

/**
 * Playback options: a discrete speed slider and a skip-inactive switch in one compact popover.
 * Shift- or Alt-click on the trigger
 * cycles the speed without opening.
 */
/** The widest rate label reserves a stable width for the speed button. */
const WIDEST_SPEED = APP_PLAYBACK_SPEEDS.reduce((widest, speed) => (String(speed).length > String(widest).length ? speed : widest));

function PlaybackOptions() {
  const rateId = useId();
  const player = usePlayer();
  const { speed: recordedSpeed, skipInactive } = usePlayerState();
  const speed = useAppPlaybackSpeed(player, recordedSpeed);
  const { open, setOpen, portalContainer } = useFullscreenPopover();
  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        const event = details.event as MouseEvent | undefined;
        if (next && (event?.shiftKey || event?.altKey)) {
          player.setSpeed(APP_PLAYBACK_SPEEDS[(APP_PLAYBACK_SPEEDS.indexOf(speed) + 1) % APP_PLAYBACK_SPEEDS.length]!);
          return;
        }
        setOpen(next);
      }}
    >
      <Hint
        label="Playback speed and skip inactive parts"
        shortcut={`${shortcutLabel('speed-down')} ${shortcutLabel('speed-up')}`}
        align="end"
      >
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              // Stable width and symmetric insets keep every rate centred as it changes.
              className="playback-options h-7 rounded-md px-2"
              data-speed-changed={speed === 1 ? undefined : ''}
              aria-label={`Playback: ${speed}× speed, skip inactive ${skipInactive ? 'on' : 'off'}`}
            />
          }
        >
          <span className="playback-speed-box">
            <span className="playback-speed-sizer" aria-hidden="true">
              {WIDEST_SPEED}×
            </span>
            <MotionLabel key={speed} kind="number" className="playback-speed number-pop" data-testid="speed-tag">
              {speed}×
            </MotionLabel>
          </span>
        </PopoverTrigger>
      </Hint>
      <PopoverContent
        side="top"
        align="end"
        portalContainer={portalContainer}
        className="playback-menu w-64 gap-3 p-3"
        aria-label="Playback"
        onKeyDown={(event) => {
          // Slider arrows, Home/End and switch Space belong to these controls, not replay shortcuts.
          if (event.key !== 'Escape') event.stopPropagation();
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <PopoverTitle className="m-0 text-xs">Playback speed</PopoverTitle>
          <output htmlFor={rateId} className="playback-rate-value">
            {speed}×
          </output>
        </div>
        <Slider
          min={0}
          max={APP_PLAYBACK_SPEEDS.length - 1}
          step={1}
          value={APP_PLAYBACK_SPEEDS.indexOf(speed)}
          onValueChange={(value) => player.setSpeed(APP_PLAYBACK_SPEEDS[value]!)}
          className="playback-rate-slider"
        >
          <SliderControl>
            <SliderTrack>
              <SliderIndicator />
              <SliderThumb id={rateId} aria-label="Playback speed" getAriaValueText={(value) => `${APP_PLAYBACK_SPEEDS[Number(value)]}×`} />
            </SliderTrack>
          </SliderControl>
        </Slider>
        <div className="playback-rate-labels" aria-label="Speed presets">
          {([0.5, 1, 2, 4] as const).map((preset) => (
            <Button
              key={preset}
              variant={speed === preset ? 'secondary' : 'ghost'}
              size="sm"
              className="flex-1 tabular-nums"
              aria-label={`Set playback speed to ${preset}×`}
              aria-pressed={speed === preset}
              onClick={() => player.setSpeed(preset)}
            >
              {preset}×
            </Button>
          ))}
        </div>
        <SkipInactiveSwitch id={`${rateId}-skip`} />
      </PopoverContent>
    </Popover>
  );
}

/** "Skip inactive parts", left out when the playback cannot skip (compared recordings share one ruler). */
function SkipInactiveSwitch({ id }: { id: string }) {
  const player = usePlayer();
  const { skipInactive } = usePlayerState();
  if (player.canSkipInactive === false) return null;
  return (
    <div className="playback-skip">
      <label id={`${id}-label`} htmlFor={id}>
        Skip inactive parts
      </label>
      <Switch
        id={id}
        nativeButton
        render={<button type="button" />}
        aria-labelledby={`${id}-label`}
        checked={skipInactive}
        onCheckedChange={(checked) => player.setSkipInactive(checked)}
      />
    </div>
  );
}

/** Fullscreen sits on the player itself, bottom-right; it fades in on hover or keyboard navigation (always shown on touch). */
export function FullscreenButton({ region }: { region: RefObject<HTMLElement | null> }) {
  const presence = useFullscreenPresence();
  const { switchFullscreen } = useViewer();
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement) && document.fullscreenElement === region.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, [region]);
  if (!document.fullscreenEnabled) return null;
  const label = fullscreen ? 'Exit fullscreen' : 'Fullscreen';
  return (
    <IconButton
      ref={presence}
      className="fullscreen-button"
      label={label}
      shortcut={shortcutLabel('fullscreen')}
      tooltipSide="left"
      aria-pressed={fullscreen}
      onClick={switchFullscreen}
    >
      {fullscreen ? <AnimatedIcon name="minimize" /> : <AnimatedIcon name="maximize" />}
    </IconButton>
  );
}

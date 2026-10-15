import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { AnimatedIcon } from '@/components/animated-icon.tsx';

import { formatClock } from '../../shared/replay.ts';
import { type Speed, SPEEDS, usePlayer, usePlayerState, usePlayhead, useViewport } from '../player.ts';
import { activeStepIndex, fitViewport } from '../timeline.ts';

export { activeStepIndex };
import { Hint, IconButton, SwitchIconButton } from '@/components/icon-button.tsx';
import { shortcutLabel } from '../shortcuts.ts';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { useViewer } from './context.ts';
import { afterMorphStart, afterPageTransition, freshPoster, swappingInPlace } from '../navigation.ts';
import { Scrubber } from './Scrubber.tsx';

/** Replays up to this many events mount during the page transition (a few ms); bigger ones after it. */
const LIGHT_MOUNT_EVENTS = 3000;

/** How long a click on the stage waits for a second click (double click = fullscreen) before flipping playback. */
const DOUBLE_CLICK_MS = 220;

export function PlayerStage() {
  const player = usePlayer();
  const viewport = useViewport();
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);

  // The recorded frame (`.player-frame`, at the fitted rect) holds rrweb's host and, when opened from a card,
  // that card's poster on top: the page transition morphs the card into this element (navigation.ts). A light
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
  const [covering, setCovering] = useState(Boolean(cover));
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    let unmount: (() => void) | undefined;
    const mount = () => {
      if (!live || !host.current) return;
      unmount = player.mount(host.current);
      requestAnimationFrame(() => requestAnimationFrame(() => live && setCovering(false)));
    };
    // A run switch crossfades in place: the new run's frame is painted inside it (navigation.ts swapInPlace).
    if (swappingInPlace()) mount();
    else void (player.eventCount <= LIGHT_MOUNT_EVENTS ? afterMorphStart() : afterPageTransition()).then(mount);
    return () => {
      live = false;
      unmount?.();
    };
  }, [player]);

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
          <img className="player-cover" src={cover} alt="" decoding="sync" draggable={false} data-covering={covering || undefined} />
        ) : null}
      </div>
      {flash ? (
        <span key={flash.id} className="stage-flash" data-kind={flash.kind} aria-hidden="true" data-testid="stage-flash">
          <svg viewBox="0 0 24 24">
            {flash.kind === 'play' ? <path d="M8 5.5v13l10.5-6.5z" /> : <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />}
          </svg>
        </span>
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
      <TimeReadout />
      <Scrubber steps={steps} errors={errors} />
      {steps.length > 0 && !editCaptions ? <CaptionsSwitch /> : null}
      <PlaybackOptions />
    </div>
  );
}

function PlayButton() {
  const player = usePlayer();
  const { status } = usePlayerState();
  const label = status === 'playing' ? 'Pause' : status === 'ended' ? 'Replay from start' : 'Play';
  return (
    <IconButton
      label={label}
      shortcut={shortcutLabel('play-pause')}
      tooltipAlign="start"
      className="play-button text-foreground"
      onClick={() => player.playPause()}
    >
      <span className="icon-swap" data-state={status === 'playing' ? 'b' : 'a'} aria-hidden="true">
        {status === 'ended' ? (
          <AnimatedIcon name="rotate-ccw" className="icon-a" />
        ) : (
          <AnimatedIcon name="play" className="icon-a filled-icon" trigger="state" play={status === 'playing' ? false : status} />
        )}
        <AnimatedIcon name="pause" className="icon-b filled-icon" trigger="state" play={status === 'playing' ? 'playing' : false} />
      </span>
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

/**
 * Playback options behind a quiet text trigger that shows the speed ("1×", accent when not 1×). A standard menu:
 * "Playback speed" as radio items (the < > keys step through them from anywhere), then Skip inactive as a
 * checkbox item that stays open. Shift- or Alt-click on the trigger
 * cycles the speed without opening.
 */
/** The rate whose label is widest in tabular figures (0.5 and 1.5 tie); it sizes the speed button. */
const WIDEST_SPEED = SPEEDS.reduce((widest, speed) => (String(speed).length > String(widest).length ? speed : widest));

function PlaybackOptions() {
  const player = usePlayer();
  const { speed, skipInactive } = usePlayerState();
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next, details) => {
        const event = details.event as MouseEvent | undefined;
        if (next && (event?.shiftKey || event?.altKey)) {
          player.setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!);
          return;
        }
        setOpen(next);
      }}
    >
      <Hint label="Playback speed and options" shortcut={`${shortcutLabel('speed-down')} ${shortcutLabel('speed-up')}`} align="end">
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              // Same family as the captions switch: 28 px tall, 6 px radius; as wide as the widest rate (plus its
              // insets), the label left-aligned 6 px after the captions chip, so a speed change never moves the row.
              className="playback-options h-7 rounded-md pr-1.5 pl-[3px]"
              data-speed-changed={speed === 1 ? undefined : ''}
              aria-label={`Playback: ${speed}× speed, skip inactive ${skipInactive ? 'on' : 'off'}`}
            />
          }
        >
          <span className="playback-speed-box">
            <span className="playback-speed-sizer" aria-hidden="true">
              {WIDEST_SPEED}×
            </span>
            <span key={speed} className="playback-speed number-pop" data-testid="speed-tag">
              {speed}×
            </span>
          </span>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent side="top" align="end" className="playback-menu w-auto min-w-48" aria-label="Playback">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between gap-3">
            Playback speed
            <span className="flex gap-0.5" aria-label="Keys: less than and greater than">
              <Kbd>{shortcutLabel('speed-down')}</Kbd>
              <Kbd>{shortcutLabel('speed-up')}</Kbd>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup value={String(speed)} onValueChange={(value) => player.setSpeed(Number(value) as Speed)}>
            {SPEEDS.map((value) => (
              <DropdownMenuRadioItem key={value} value={String(value)} closeOnClick className="tabular-nums">
                {value}×
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={skipInactive}
          closeOnClick={false}
          onCheckedChange={(checked) => player.setSkipInactive(checked)}
          title="Fast-forward through idle gaps"
        >
          Skip inactive
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Step captions on the player: a quiet switch, shown only when the replay has step labels. */
function CaptionsSwitch() {
  const { captions, switchCaptions } = useViewer();
  return (
    <SwitchIconButton
      // Pressed = accent icon on a faint 28 px accent tint (the chip), no ring; on touch the 40 px target grows
      // around the same chip, so the row keeps desktop's rhythm.
      className="captions-switch h-7 min-w-7 px-0 aria-pressed:ring-0 aria-pressed:bg-transparent aria-pressed:text-[var(--accent)]"
      label={captions ? 'Hide step captions' : 'Show step captions'}
      shortcut={shortcutLabel('switch-captions')}
      pressed={captions}
      onPressedChange={switchCaptions}
      data-testid="captions-switch"
    >
      <span className="captions-chip" aria-hidden="true">
        <AnimatedIcon name="captions" />
      </span>
    </SwitchIconButton>
  );
}

/** Fullscreen sits on the player itself, bottom-right; it fades in on hover or keyboard navigation (always shown on touch). */
export function FullscreenButton({ region }: { region: RefObject<HTMLElement | null> }) {
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

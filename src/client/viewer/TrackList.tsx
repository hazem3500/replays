import { ArrowDownToLineIcon, ArrowUpToLineIcon, GripHorizontalIcon } from 'lucide-react';
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { formatClock } from '../../shared/replay.ts';
import { usePlayer, usePlayerState } from '../player.ts';
import { createSpring } from '../spring.ts';
import { Button } from '@/components/ui/button.tsx';

export const HEADER_HEIGHT = 28;
export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** How long after a wheel, touch or key in a list the follow mode keeps its hands off the scroll position. */
const USER_SCROLL_GRACE_MS = 1500;

/**
 * The scrolling frame shared by Console, Network and Performance. Every entry is listed; the ones after the
 * playhead are faded by their rows (data-future). A "now" divider sits between the last reached and the first
 * upcoming row, as an overlay at a computed offset (never a row, so windowing maths stay simple). While
 * following, playback and seeks keep the divider in view near the bottom; scrolling away stops that and shows
 * "Back to now". Nothing here runs per frame: the divider only moves when the reached count changes.
 */
export function TrackList({
  testId,
  scrollClassName,
  reached,
  total,
  rowHeight,
  extraIndex = -1,
  extraHeight = 0,
  ats,
  scroller,
  children,
}: {
  testId: string;
  scrollClassName?: string;
  reached: number;
  total: number;
  rowHeight: number;
  extraIndex?: number;
  extraHeight?: number;
  /** Entry times, sorted: the divider snaps the playhead to them while dragged. */
  ats: readonly number[];
  scroller: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const player = usePlayer();
  const { status } = usePlayerState();
  const [following, setFollowing] = useState(true);
  const [recall, setRecall] = useState(0);
  // Reading mode: a text selection in the panel or a scroll while paused (and, while paused, an expanded
  // request) means someone is reading: no auto-follow and no edge tint until playback resumes or Back to now.
  const [readingState, setReading] = useState(false);
  // An expanded request holds the list where it is, even while playing: someone is reading its detail.
  // "Back to now" overrides an open request's hold until another request opens.
  const [detailRelease, setDetailRelease] = useState<number | undefined>(undefined);
  const holdForDetail = extraIndex >= 0 && detailRelease !== extraIndex;
  const reading = holdForDetail || (status !== 'playing' && readingState);
  const [edge, setEdge] = useState<'top' | 'bottom'>();
  const statusRef = useRef(status);
  // performance.now() of the user's last wheel, touch, press or key in the list (never, to start with).
  const userAt = useRef(Number.NEGATIVE_INFINITY);
  // The scrollTop this list last scrolled itself to: a scroll event landing there is ours, not the user's.
  const ours = useRef(-1);
  // Playback resuming ends reading mode.
  useLayoutEffect(
    () =>
      player.subscribeState(() => {
        const next = player.getState().status;
        statusRef.current = next;
        if (next === 'playing') setReading(false);
      }),
    [player],
  );
  const dividerTop = nowOffset(reached, total, rowHeight, extraIndex, extraHeight);
  // Between entries the divider always shows; at either end (no entries on one side) only while the pointer is
  // over the panel (data-now-end + CSS), and never as an edge tint.
  // A drag that reaches either end keeps the divider (it is what is being dragged) until release.
  const [dragActive, setDragActive] = useState(false);
  const midway = (reached > 0 && reached < total) || dragActive;
  // A list whose rows all fit needs no divider: the faded upcoming rows already show where now is. It stays mounted
  // (follow logic unchanged) and fades out; re-checked when the list or its content resizes (panel height, tab
  // switch, rows arriving, an expanded request).
  // Until measured (a new tab, a hidden panel) the divider counts as not needed and shows nothing. Showing or hiding
  // it is instant, except when the list's own viewport is resized across the threshold (dragging the panel's
  // edge): only that fades (`animate`, for one transition). Content changes and a tab coming into view jump.
  // A list of one or two entries needs no divider: the faded upcoming rows already say where now is. From three
  // rows on it shows, scrolling or not. Decided from the row count alone, before paint, so a tab switch never
  // flashes it.
  const fit = { fits: total <= MAX_ROWS_WITHOUT_DIVIDER };
  // At either end the line is hidden until the pointer (or a finger) comes within NEAR_EDGE px of where it rests.
  const [near, setNear] = useState(false);
  const checkNear = (event: ReactPointerEvent<HTMLElement>) => {
    const line = event.currentTarget.querySelector<HTMLElement>('.now-divider');
    if (!line) return;
    const next = Math.abs(event.clientY - line.getBoundingClientRect().top) <= NEAR_EDGE;
    if (next !== near) setNear(next);
  };
  const dividerRef = useRef(dividerTop);
  useLayoutEffect(() => {
    dividerRef.current = dividerTop;
  }, [dividerTop]);

  // A seek (step click, error jump, time click) brings the list back to now.
  useLayoutEffect(
    () =>
      player.subscribeSeek(() => {
        // An explicit seek is a request to go somewhere: it also ends reading mode (a scroll while paused).
        setReading(false);
        setFollowing(true);
        setRecall((value) => value + 1);
      }),
    [player],
  );

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const touched = () => {
      userAt.current = performance.now();
    };
    const onScroll = () => {
      if (ours.current >= 0 && Math.abs(element.scrollTop - ours.current) < 1) {
        ours.current = -1;
        return;
      }
      ours.current = -1;
      if (performance.now() - userAt.current > USER_SCROLL_GRACE_MS) return;
      if (statusRef.current !== 'playing') setReading(true);
      const top = dividerRef.current;
      const inView = top >= element.scrollTop + HEADER_HEIGHT && top <= element.scrollTop + element.clientHeight;
      setFollowing(inView);
    };
    element.addEventListener('wheel', touched, { passive: true });
    element.addEventListener('touchstart', touched, { passive: true });
    element.addEventListener('pointerdown', touched);
    element.addEventListener('keydown', touched);
    element.addEventListener('scroll', onScroll, { passive: true });
    const onSelection = () => {
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed && selection.anchorNode && element.contains(selection.anchorNode)) setReading(true);
    };
    document.addEventListener('selectionchange', onSelection);
    // A list that was hidden (another tab) or resized re-checks where now is once it has a size.
    let lastHeight = element.clientHeight;
    const observer = new ResizeObserver(() => {
      if (element.clientHeight === lastHeight) return;
      lastHeight = element.clientHeight;
      setRecall((value) => value + 1);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      document.removeEventListener('selectionchange', onSelection);
      element.removeEventListener('wheel', touched);
      element.removeEventListener('touchstart', touched);
      element.removeEventListener('pointerdown', touched);
      element.removeEventListener('keydown', touched);
      element.removeEventListener('scroll', onScroll);
    };
  }, [scroller]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !following || reading || element.clientHeight === 0) return;
    const sinceUser = performance.now() - userAt.current;
    if (sinceUser < USER_SCROLL_GRACE_MS) {
      // Hands off while the user is scrolling; look again once the grace period is over.
      const retry = window.setTimeout(() => setRecall((value) => value + 1), USER_SCROLL_GRACE_MS - sinceUser + 20);
      return () => window.clearTimeout(retry);
    }
    const top = dividerTop;
    if (top >= element.scrollTop + HEADER_HEIGHT + 8 && top <= element.scrollTop + element.clientHeight - 8) return;
    const target = Math.max(0, Math.round(top - element.clientHeight * 0.75));
    if (target === element.scrollTop) return;
    scrollListTo(element, target);
    ours.current = element.scrollTop;
    // `recall` re-runs this after a seek or "Back to now" even when the divider did not move.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [dividerTop, following, reading, recall, scroller]);

  return (
    <div
      className="track-panel"
      data-now-edge={midway ? edge : undefined}
      data-now-end={total > 0 && !midway ? '' : undefined}
      data-fits={fit.fits && !dragActive ? '' : undefined}
      data-reading={reading || undefined}
      data-playing={status === 'playing' || undefined}
      data-now-near={(total > 0 && !midway && near) || undefined}
      onPointerMove={checkNear}
      onPointerDown={checkNear}
      onPointerLeave={() => setNear(false)}
      onPointerUp={(event) => {
        if (event.pointerType !== 'mouse') setNear(false);
      }}
    >
      <div ref={scroller} data-testid={testId} className={`table-scroll track-scroll ${scrollClassName ?? ''}`}>
        {children}
        {total > 0 ? (
          <NowDivider
            top={dividerTop}
            reached={reached}
            ats={ats}
            rowHeight={rowHeight}
            extraIndex={extraIndex}
            extraHeight={extraHeight}
            onInteract={() => {
              userAt.current = performance.now();
            }}
            onEdge={setEdge}
            onDragChange={setDragActive}
            onFollow={() => {
              userAt.current = Number.NEGATIVE_INFINITY;
              setReading(false);
              setFollowing(true);
              setRecall((value) => value + 1);
            }}
          />
        ) : null}
      </div>
      {/* Only when it would scroll somewhere meaningful: mid-list, with now out of view. */}
      {(following && !reading) || !(reached > 0 && reached < total && edge) ? null : (
        <Button
          variant="outline"
          size="sm"
          className="back-to-now"
          onClick={() => {
            userAt.current = Number.NEGATIVE_INFINITY;
            if (extraIndex >= 0) setDetailRelease(extraIndex);
            setReading(false);
            setFollowing(true);
            setRecall((value) => value + 1);
          }}
        >
          {/* The arrow points to where now is: up when it is above the visible rows, down when below. */}
          {edge === 'top' ? <ArrowUpToLineIcon aria-hidden="true" /> : <ArrowDownToLineIcon aria-hidden="true" />}
          Back to now
        </Button>
      )}
    </div>
  );
}

/** Rows start this far below the sticky header (and a matching gap follows the last row). Zero: the first row meets the header, so its highlight touches it. */
export const TRACK_GAP = 0;
/** Lists this short show no now divider (TrackList). */
const MAX_ROWS_WITHOUT_DIVIDER = 2;
export const TRAILING_GAP = 12;
/** A jump (seek, drag, a tab shown) moves the divider at once; its fit fade comes from styles.css only while resizing. */
const JUMP_TRANSITION = 'none';
/** At either end of a list the hidden now divider shows when the pointer is this close (px) to where it rests. */
const NEAR_EDGE = 32;

/** Where "now" falls in the scroll content: in the leading gap before any entry, between rows, or in the trailing gap. */
function nowOffset(reached: number, total: number, rowHeight: number, extraIndex: number, extraHeight: number) {
  const rows = (count: number) => count * rowHeight + (extraIndex >= 0 && extraIndex < count ? extraHeight : 0);
  // At the very start the line rests just under the header's hairline (shown only while the pointer is over the panel).
  if (reached <= 0) return HEADER_HEIGHT + Math.max(1, TRACK_GAP / 2);
  if (reached >= total) return HEADER_HEIGHT + TRACK_GAP + rows(total) + TRACK_GAP / 2;
  return HEADER_HEIGHT + TRACK_GAP + rows(reached);
}

/**
 * Where to seek to land on an entry: its own time, except an entry stamped 0:00.0, which is landed on 1 ms in (the
 * very start is before every entry, so seeking there would leave it upcoming). The clock still reads 0:00.0.
 */
function seekPastStart(at: number) {
  return Math.max(at, 1);
}

export function scrollListTo(element: HTMLElement, top: number) {
  element.scrollTop = top;
}

/** The current frame time (ms), for drag maths outside rAF callbacks. */
function frameTime() {
  return performance.now();
}

/** Puts the now line at `y` in its list's content. */
function placeLine(element: HTMLElement, y: number) {
  element.style.transform = `translateY(${y.toFixed(1)}px)`;
}
/** Moves of more than this many rows (a seek, a step jump) are instant; smaller ones glide while playing. */
const GLIDE_MAX_ROWS = 3;
/** Hover intent: the pointer rests this long in the line's band before the line and grip come up. */
const HOVER_REVEAL_MS = 250;
/** The grip's keyboard x (the Time column's gutter) and its width. */
const GRIP_REST_X = 6;
const GRIP_WIDTH = 28;
/** While dragging the divider within this many pixels of the list's top or bottom, the list scrolls. */
const DRAG_EDGE = 48;
/** Top auto-scroll speed while dragging the now divider into an edge zone, px/s (up to 3× beyond the panel). */
const EDGE_MAX_SPEED = 2400;
/** How quickly the auto-scroll velocity follows its target (time constant, ms): no jumps entering or leaving. */
const EDGE_SMOOTH_MS = 90;
/** After a release mid-scroll, the list coasts to a stop over this long. */
const EDGE_COAST_MS = 200;

/** After a release mid-scroll the list coasts to a stop (ease-out); the playhead stays where it was released. */
function coast(list: HTMLElement, velocity: number) {
  if (!velocity || prefersReducedMotion()) return;
  const start = performance.now();
  let last = start;
  let position = list.scrollTop;
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / EDGE_COAST_MS);
    const v = velocity * (1 - t) ** 2;
    position += (v * Math.min(64, now - last)) / 1000;
    last = now;
    list.scrollTop = position;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Auto-scroll speed (px/s) for a drag `depth` px into an edge zone of `zone` px: ease-in-quad up to the top speed
 * at the edge, then growing up to 3× as the pointer goes further past the panel (long lists).
 */
export function edgeVelocity(depth: number, zone = DRAG_EDGE, max = EDGE_MAX_SPEED) {
  if (depth <= 0) return 0;
  const inside = Math.min(depth / zone, 1);
  const beyond = Math.min(Math.max(depth - zone, 0) / (zone * 2), 1);
  return max * inside * inside * (1 + 2 * beyond);
}

/**
 * "Now": a 1.5 px accent line on the boundary between the last reached and the first upcoming row, fading
 * out to the right. It glides (transform, 150 ms) when playback crosses a row or three and jumps on seeks,
 * scrubs and scrolls; scrolled away it pins to the edge with a chevron. Its grip (in the Time column's gutter,
 * shown on hover and keyboard navigation) is a slider: drag the line to scrub, snapping the playhead to entry times (the list
 * scrolls near its edges), or use ↑/↓/Home/End.
 */
function NowDivider({
  top,
  reached,
  ats,
  rowHeight,
  extraIndex,
  extraHeight,
  onInteract,
  onEdge,
  onFollow,
  onDragChange,
}: {
  top: number;
  reached: number;
  ats: readonly number[];
  rowHeight: number;
  extraIndex: number;
  extraHeight: number;
  onInteract: () => void;
  /** Scrolled out of view, the divider draws nothing in the rows: the panel tints that edge instead. */
  onEdge: (edge: 'top' | 'bottom' | undefined) => void;
  /** Keyboard moves and a finished drag hand the list back to follow mode. */
  onFollow: () => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const player = usePlayer();
  const { status } = usePlayerState();
  const line = useRef<HTMLDivElement>(null);
  const previous = useRef({ shown: -1, reached, viewTop: 0, viewHeight: 0 });
  const drag = useRef<
    | {
        pointerId: number;
        clientX: number;
        clientY: number;
        target: number;
        frame: number;
        /** The playhead when the drag began: Escape goes back there. */
        startTime: number;
        /** Auto-scroll: current velocity (px/s), the list's fractional scroll position, the last frame's time. */
        velocity: number;
        scroll: number;
        last: number;
        alt: boolean;
        shift: boolean;
      }
    | undefined
  >(undefined);
  // Pointer modality: a press on the grip's row must not move the grip to the keyboard spot.
  const pointerPress = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState({ top: 0, height: 0 });
  const total = ats.length;
  // Weight: the grip trails the pointer, and while dragging the line settles onto each snapped boundary,
  // on one shared spring tuning (src/client/spring.ts). Created once; they write transforms directly.
  const springs = useRef<{ x: ReturnType<typeof createSpring>; y: ReturnType<typeof createSpring> } | undefined>(undefined);
  useLayoutEffect(() => {
    const element = line.current;
    if (!element) return;
    const created = {
      x: createSpring({ onUpdate: (x) => element.style.setProperty('--grip-x', `${x.toFixed(1)}px`) }),
      y: createSpring({
        onUpdate: (y) => placeLine(element, y),
      }),
    };
    springs.current = created;
    // Hidden, the grip waits at the right end, clear of the Time column's seek buttons.
    created.x.set(Math.max(8, element.getBoundingClientRect().width - GRIP_WIDTH - 8), true);
    return () => {
      created.x.stop();
      created.y.stop();
    };
  }, []);

  // The scroll container is this line's parent (read in an effect: a parent's ref is attached after its
  // children's layout effects run).
  useLayoutEffect(() => {
    const element = line.current?.parentElement;
    if (!element) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setView((current) =>
        current.top === element.scrollTop && current.height === element.clientHeight
          ? current
          : { top: element.scrollTop, height: element.clientHeight },
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    element.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('scroll', schedule);
      observer.disconnect();
    };
  }, []);
  // The line keeps clear of the header's hairline and the bottom edge, never landing inside the first (or last) row;
  // its grip stays centred on it, straddling the hairline at the very top (it draws above the sticky header).
  const min = view.top + HEADER_HEIGHT + 1;
  const max = view.height > 0 ? view.top + view.height - 1 : Number.POSITIVE_INFINITY;
  const shown = Math.min(Math.max(top, min), max);
  // Pinned means scrolled out of view (not merely held clear of the header at the very start or end).
  const pinned = dragging
    ? undefined
    : view.height > 0 && top > view.top + view.height
      ? 'bottom'
      : top < view.top + HEADER_HEIGHT
        ? 'top'
        : undefined;
  useLayoutEffect(() => onEdge(pinned), [onEdge, pinned]);
  // Unmounted (the playhead left the middle of the list): no edge tint either.
  useLayoutEffect(() => () => onEdge(undefined), [onEdge]);

  // Imperative, so the glide decision sees the previous position without re-rendering. Skipped while
  // dragging: the drag's spring owns the line then.
  useLayoutEffect(() => {
    const element = line.current;
    const last = previous.current;
    if (!element || drag.current) return;
    springs.current?.y.stop();
    const steps = Math.abs(reached - last.reached);
    const glide =
      last.shown >= 0 &&
      status === 'playing' &&
      steps > 0 &&
      steps <= GLIDE_MAX_ROWS &&
      view.top === last.viewTop &&
      view.height === last.viewHeight &&
      !pinned;
    element.style.transition = glide ? '' : JUMP_TRANSITION;
    placeLine(element, shown);
    springs.current?.y.set(shown, true);
    previous.current = { shown, reached, viewTop: view.top, viewHeight: view.height };
    // `dragging` re-places the line where it belongs when a drag ends.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [pinned, reached, shown, status, view.top, view.height, dragging]);

  /** The playhead for "now after `count` entries": the start, an entry's time, or the end. */
  const timeFor = (count: number) =>
    count <= 0 ? 0 : count >= total ? Math.max(ats[total - 1] ?? 0, player.duration) : seekPastStart(ats[count - 1]!);
  const seekTo = (count: number) => {
    const next = Math.min(total, Math.max(0, count));
    player.seek(timeFor(next));
    return next;
  };
  /** Which boundary a content y falls on (rounded to the nearest), allowing for an expanded request. */
  const countAt = (y: number) => {
    let offset = y - HEADER_HEIGHT - TRACK_GAP;
    if (extraIndex >= 0 && offset > (extraIndex + 1) * rowHeight) offset -= Math.min(extraHeight, offset - (extraIndex + 1) * rowHeight);
    return Math.min(total, Math.max(0, Math.round(offset / Math.max(1, rowHeight))));
  };
  /**
   * The grip appears centred under the pointer where it first meets the line and stays anchored there (no
   * horizontal following) until it has fully hidden; the next hover anchors anew. It scales in on a heavy
   * spring and fades out in place (CSS, 140 ms).
   */
  const anchored = useRef(false);
  const hideTimer = useRef(0);
  const showGrip = (x: number | 'keyboard') => {
    const element = line.current;
    if (!element) return;
    window.clearTimeout(hideTimer.current);
    if (!anchored.current) {
      const width = element.getBoundingClientRect().width;
      const left = x === 'keyboard' ? GRIP_REST_X : x - element.getBoundingClientRect().left - GRIP_WIDTH / 2;
      springs.current?.x.set(Math.min(Math.max(left, 8), width - GRIP_WIDTH - 8), true);
      anchored.current = true;
    }
    element.dataset.grip = 'shown';
  };
  // Hover intent: the reveal waits until the pointer has rested in the band for HOVER_REVEAL_MS; a quick pass shows
  // nothing. The grip then anchors at the pointer's x at that moment.
  const revealTimer = useRef(0);
  const pointerX = useRef(0);
  const intendReveal = (clientX: number) => {
    pointerX.current = clientX;
    window.clearTimeout(revealTimer.current);
    revealTimer.current = window.setTimeout(() => showGrip(pointerX.current), HOVER_REVEAL_MS);
  };
  const hideGrip = () => {
    const element = line.current;
    // Only the keyboard keeps it up; a press with a pointer does not.
    if (!element || drag.current || element.querySelector(':focus-visible')) return;
    window.clearTimeout(revealTimer.current);
    delete element.dataset.grip;
    window.clearTimeout(hideTimer.current);
    // Fully hidden after the 140 ms fade: the next hover anchors where it starts.
    hideTimer.current = window.setTimeout(() => {
      anchored.current = false;
    }, 160);
  };
  // While the grip shows, a document-level guard hides it as soon as the pointer is outside the panel: fast exits
  // and moves into the player's iframe (which swallows pointer events) never reach the band's pointerleave.
  const hideRef = useRef(hideGrip);
  useLayoutEffect(() => {
    hideRef.current = hideGrip;
  });
  useLayoutEffect(() => {
    const check = (event: PointerEvent) => {
      const element = line.current;
      if (!element || element.dataset.grip !== 'shown' || drag.current) return;
      const panel = element.closest('.track-panel');
      if (!panel) return;
      const box = panel.getBoundingClientRect();
      const leftDocument = event.type === 'pointerout' && (!event.relatedTarget || (event.relatedTarget as Element).tagName === 'IFRAME');
      const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      if (leftDocument || !inside) hideRef.current();
    };
    document.addEventListener('pointermove', check, true);
    document.addEventListener('pointerout', check, true);
    return () => {
      document.removeEventListener('pointermove', check, true);
      document.removeEventListener('pointerout', check, true);
    };
  }, []);
  /**
   * One drag frame: auto-scroll when the pointer is in (or past) an edge zone, the playhead to the boundary under
   * the pointer, the line onto it. The scroll velocity eases toward edgeVelocity() (Alt 4× slower for precision,
   * Shift 2× faster), so speed changes smoothly as the pointer moves deeper; while it scrolls the line stays pinned
   * at the edge and time keeps following. Runs per animation frame only while something is moving.
   */
  const follow = (time?: number) => {
    const now = time ?? frameTime();
    const state = drag.current;
    const element = line.current;
    const list = element?.parentElement;
    if (!state || !element || !list) return;
    const dt = Math.min(64, Math.max(0, now - state.last)) / 1000;
    state.last = now;
    // The person scrolled the list themselves (a wheel mid-drag): pick up from there.
    if (Math.abs(list.scrollTop - state.scroll) > 2) state.scroll = list.scrollTop;
    const box = list.getBoundingClientRect();
    const above = box.top + HEADER_HEIGHT + DRAG_EDGE - state.clientY;
    const below = state.clientY - (box.bottom - DRAG_EDGE);
    let target = above > 0 ? -edgeVelocity(above) : below > 0 ? edgeVelocity(below) : 0;
    if (state.alt) target /= 4;
    else if (state.shift) target *= 2;
    const maxScroll = list.scrollHeight - list.clientHeight;
    if ((target < 0 && state.scroll <= 0) || (target > 0 && state.scroll >= maxScroll)) target = 0;
    state.velocity += (target - state.velocity) * (1 - Math.exp((-dt * 1000) / EDGE_SMOOTH_MS));
    if (target === 0 && Math.abs(state.velocity) < 4) state.velocity = 0;
    if (state.velocity) {
      state.scroll = Math.min(Math.max(state.scroll + state.velocity * dt, 0), maxScroll);
      scrollListTo(list, state.scroll);
    }
    const y = Math.min(
      Math.max(state.clientY - box.top + list.scrollTop, list.scrollTop + HEADER_HEIGHT),
      list.scrollTop + list.clientHeight,
    );
    const count = countAt(y);
    if (count !== state.target) {
      state.target = seekTo(count);
    }
    // The line settles onto the snapped boundary with weight; the grip keeps to the pointer's x.
    element.style.transition = JUMP_TRANSITION;
    springs.current?.y.set(
      Math.min(
        Math.max(nowOffset(state.target, total, rowHeight, extraIndex, extraHeight), list.scrollTop + HEADER_HEIGHT + 1),
        list.scrollTop + list.clientHeight - 1,
      ),
    );
    onInteract();
    state.frame = state.velocity || target ? requestAnimationFrame(follow) : 0;
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const list = line.current?.parentElement;
    drag.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      target: reached,
      frame: 0,
      startTime: player.getTime(),
      velocity: 0,
      scroll: list?.scrollTop ?? 0,
      last: performance.now(),
      alt: event.altKey,
      shift: event.shiftKey,
    };
    showGrip(event.clientX);
    pointerPress.current = true;
    line.current?.querySelector<HTMLElement>('.now-grip')?.focus({ preventScroll: true });
    pointerPress.current = false;
    setDragging(true);
    onDragChange(true);
    onInteract();
    player.beginScrub();
    follow();
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state) {
      // Before the reveal, the grip will anchor wherever the pointer rests.
      if (event.pointerType === 'mouse' && !anchored.current) pointerX.current = event.clientX;
      return;
    }
    if (state.pointerId !== event.pointerId) return;
    state.clientX = event.clientX;
    state.clientY = event.clientY;
    state.alt = event.altKey;
    state.shift = event.shiftKey;
    if (!state.frame) {
      state.last = performance.now();
      state.frame = requestAnimationFrame(follow);
    }
  };
  /**
   * Ends a drag however it ends: pointer up or cancel, lost capture, Escape, or the window losing the keyboard. The grip
   * the press activated is blurred (a pointer press is not keyboard use), and the bright state follows real hover
   * again: the release point decides (elementFromPoint), not a :hover the capture left stale.
   */
  const endDrag = (release?: { pointerType: string; clientX: number; clientY: number }, cancel = false) => {
    const state = drag.current;
    if (!state) return;
    cancelAnimationFrame(state.frame);
    const list = line.current?.parentElement;
    if (list && !cancel) coast(list, state.velocity);
    drag.current = undefined;
    springs.current?.y.stop();
    setDragging(false);
    onDragChange(false);
    line.current?.querySelector<HTMLElement>('.now-grip')?.blur();
    const under = release && release.pointerType === 'mouse' ? document.elementFromPoint(release.clientX, release.clientY) : null;
    if (!under || !line.current?.contains(under)) hideGrip();
    player.endScrub();
    // Releasing keeps following. Escape puts the playhead back where the drag began.
    onFollow();
    player.seek(cancel ? state.startTime : timeFor(state.target));
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLElement>) => endDrag(event);
  const endDragRef = useRef(endDrag);
  const followRef = useRef(follow);
  useLayoutEffect(() => {
    endDragRef.current = endDrag;
    followRef.current = follow;
  });
  useEffect(() => {
    if (!dragging) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        endDragRef.current(undefined, true);
        return;
      }
      // Alt (precision) and Shift (faster) apply as soon as they are pressed, not on the next pointer move.
      const state = drag.current;
      if (state && (event.key === 'Alt' || event.key === 'Shift')) {
        state.alt = event.altKey;
        state.shift = event.shiftKey;
        if (!state.frame) {
          state.last = performance.now();
          state.frame = requestAnimationFrame((time) => followRef.current(time));
        }
      }
    };
    const onBlur = () => endDragRef.current();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [dragging]);

  const clock = formatClock(timeFor(reached));
  const where =
    reached <= 0 ? 'before the first entry' : reached >= total ? 'after the last entry' : `between entry ${reached} and ${reached + 1}`;
  const handlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onLostPointerCapture: onPointerEnd,
  };
  return (
    <div
      ref={line}
      className="now-divider"
      data-testid="now-divider"
      data-reached={reached}
      data-pinned={pinned}
      data-dragging={dragging || undefined}
    >
      <span
        className="now-hit"
        aria-hidden="true"
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') intendReveal(event.clientX);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse' && !(event.relatedTarget instanceof Element && event.relatedTarget.closest('.now-grip')))
            hideGrip();
        }}
        {...handlers}
      />
      <span
        className="now-grip"
        role="slider"
        tabIndex={0}
        aria-label="Now"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={reached}
        aria-valuetext={`Now ${clock}, ${where}`}
        data-testid="now-grip"
        onFocus={() => {
          // The keyboard has no pointer: the grip shows in the Time column's gutter.
          if (!pointerPress.current && !drag.current) {
            anchored.current = false;
            showGrip('keyboard');
          }
        }}
        onBlur={() => {
          if (!line.current?.matches(':hover')) hideGrip();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse' && !(event.relatedTarget instanceof Element && event.relatedTarget.closest('.now-hit')))
            hideGrip();
        }}
        onKeyDown={(event) => {
          const next =
            event.key === 'ArrowDown'
              ? reached + 1
              : event.key === 'ArrowUp'
                ? reached - 1
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? total
                    : undefined;
          if (next === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          onFollow();
          seekTo(next);
        }}
        {...handlers}
      >
        <GripHorizontalIcon aria-hidden="true" />
      </span>
    </div>
  );
}

/** The time cell: a button that seeks the replay to the entry. Upcoming entries say so in their name. */
export function SeekTime({ at, future }: { at: number; future: boolean }) {
  const player = usePlayer();
  const clock = formatClock(at);
  return (
    <button
      type="button"
      className="seek-time"
      aria-label={`Seek to ${clock}${future ? ', upcoming' : ''}`}
      onClick={() => player.seek(seekPastStart(at))}
    >
      <time>{clock}</time>
    </button>
  );
}

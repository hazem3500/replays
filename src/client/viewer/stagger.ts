import { animate } from 'motion/mini';
import { swappingInPlace } from '../transitions/state.ts';

/**
 * Rows that rise into place with a stagger: the step rail's steps and the inspector's visible rows when a replay
 * opens (once its panels fill, after the page morph) and when an inspector tab is switched to. Each visible row
 * (the first STAGGER_MAX that are on screen; windowed rows outside the viewport are never touched) rises 6 px and
 * fades in over 240 ms, ease-out, spread evenly over STAGGER_SPAN_MS whatever the list's length (so on a page reveal
 * the first rows of every list rise together and so do their last rows); transform and opacity only, through the Web Animations API, so nothing
 * stays on the rows afterwards. Never animated: a suite run swap (it crossfades whole panels), a tab switched to
 * within RAPID_SWITCH_MS of the previous one (key repeat, quick clicks), rows that arrive later (playback, scrolling,
 * windowing), and anything under reduced motion. The active step's highlight and the now divider are not rows: they
 * are right from the first frame. A page reveal is one choreography: the step rail and the inspector start on the
 * same frame, their first rows together and their last rows together (revealRows); a tab switch staggers the incoming panel alone.
 */
export const STAGGER_MAX = 14;
/** From a list's first row starting to its last row starting, however many rows it has. */
export const STAGGER_SPAN_MS = 200;
export const STAGGER_MS = 240;
const RAPID_SWITCH_MS = 300;

let lastSwitchAt = Number.NEGATIVE_INFINITY;
let lastSwitchRapid = false;

/**
 * Call when an inspector tab is chosen; the panel that mounts for it reads whether to stagger. Returns whether the
 * switch is a rapid one (it then swaps instantly, the outgoing panel included).
 */
export function noteTabSwitch() {
  const now = performance.now();
  lastSwitchRapid = now - lastSwitchAt < RAPID_SWITCH_MS;
  lastSwitchAt = now;
  return lastSwitchRapid;
}

/** Whether rows mounting right now should stagger in. */
export function shouldStagger() {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if (swappingInPlace()) return false;
  // A panel mounting just after a quick tab switch swaps instantly.
  if (lastSwitchRapid && performance.now() - lastSwitchAt < RAPID_SWITCH_MS) return false;
  return true;
}

type RowList = { container: HTMLElement; selector: string };

const running = new WeakMap<HTMLElement, { stop: () => void; restore: () => void }>();

/** The first STAGGER_MAX rows of a list that are on screen (windowed rows outside the viewport are never touched). */
function visibleRows({ container, selector }: RowList) {
  const box = container.getBoundingClientRect();
  if (box.height === 0) return [];
  return [...container.querySelectorAll<HTMLElement>(selector)]
    .filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.height > 0 && rect.bottom > box.top && rect.top < box.bottom;
    })
    .slice(0, STAGGER_MAX);
}

/**
 * One choreography over several lists: each list's rows spread over the same span, so every list's first row rises
 * at the same moment and so does every list's last row, all on one clock. Every row's animation shares one start time, so the lists stay frame-for-frame in step. Returns how many
 * rows it animated.
 */
function animateLists(lists: RowList[], startTime?: number) {
  // Every layout read before any write.
  const columns = lists.map((list) => ({ list, rows: visibleRows(list) }));
  const start = startTime ?? performance.now();
  let count = 0;
  for (const { list, rows } of columns) {
    // why: row entrances replace the panel's one-shot loading fade.
    if (rows.length) (list.container.closest('.timeline-wrap') ?? list.container).setAttribute('data-staggered', '');
    const gap = rows.length > 1 ? STAGGER_SPAN_MS / (rows.length - 1) : 0;
    for (const [index, row] of rows.entries()) {
      if (typeof row.animate !== 'function') continue;
      const previous = running.get(row);
      previous?.stop();
      previous?.restore();
      const opacity = row.style.opacity;
      const transform = row.style.transform;
      const animation = animate(
        [row],
        { opacity: [0, 1], transform: ['translateY(6px)', 'translateY(0px)'] },
        {
          duration: STAGGER_MS / 1000,
          delay: (index * gap) / 1000,
          ease: [0.23, 1, 0.32, 1],
        },
      );
      animation.time = Math.max(0, (performance.now() - start) / 1000);
      const entry = {
        stop: () => animation.stop(),
        restore: () => {
          row.style.opacity = opacity;
          row.style.transform = transform;
        },
      };
      running.set(row, entry);
      void animation.then(() => {
        if (running.get(row) !== entry) return;
        entry.restore();
        running.delete(row);
      });
      count += 1;
    }
  }
  return { count, start };
}

/* ---------- Page reveal: the step rail and the inspector together ---------- */

/** A reveal that lands within this long of the previous one joins its clock (the lists filled in separate commits). */
const SAME_REVEAL_MS = 150;
let queued: RowList[] = [];
let lastReveal: { at: number; start: number } | undefined;

/**
 * Called by each list that fills when the page is revealed (the step rail, the inspector's open panel). Lists queued
 * in the same commit are revealed by one revealRows call, on one clock; a straggler joins that clock.
 */
export function queueReveal(container: HTMLElement, selector: string) {
  // why: read now, not in the microtask: an in-place run swap has ended by then, and its rows must not rise.
  if (!shouldStagger()) return;
  if (queued.length === 0) queueMicrotask(flushReveal);
  queued.push({ container, selector });
}

function flushReveal() {
  const lists = queued;
  queued = [];
  revealRows(lists);
}

/** The page reveal: every list's visible rows rise in on one shared clock. */
export function revealRows(lists: RowList[]) {
  if (!shouldStagger()) return 0;
  const now = performance.now();
  const join = lastReveal && now - lastReveal.at < SAME_REVEAL_MS && lastSwitchAt < lastReveal.at ? lastReveal.start : undefined;
  const { count, start } = animateLists(lists, join);
  if (join === undefined) lastReveal = { at: now, start };
  return count;
}

/** A tab switch: the incoming panel's visible rows rise in on their own clock, with the same timing. */
export function staggerIn(container: HTMLElement, selector: string) {
  if (!shouldStagger()) return 0;
  return animateLists([{ container, selector }]).count;
}

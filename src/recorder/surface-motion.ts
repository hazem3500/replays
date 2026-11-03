import { animate } from 'motion/mini';

export type FloatingSurface = {
  host: HTMLElement;
  root: ShadowRoot;
  remove: () => void;
  shell: HTMLElement;
  content: HTMLElement;
  live: HTMLElement;
  label: HTMLElement;
};

const transitions = new WeakMap<HTMLElement, { animation: ReturnType<typeof animate>; timer: ReturnType<typeof setTimeout> }>();
const resting = { opacity: 1, transform: 'translateX(-50%) translateY(0) scale(1)' };
const away = { opacity: 0, transform: 'translateX(-50%) translateY(8px) scale(.98)' };

function cancel(shell: HTMLElement) {
  const previous = transitions.get(shell);
  transitions.delete(shell);
  if (previous) {
    clearTimeout(previous.timer);
    previous.animation.stop();
  }
}

function transition(shell: HTMLElement, entering: boolean, complete: () => void) {
  cancel(shell);
  if (typeof shell.animate !== 'function' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    complete();
    return;
  }
  const from = entering ? away : resting;
  const to = entering ? resting : away;
  const animation = animate(
    [shell],
    { opacity: [from.opacity, to.opacity], transform: [from.transform, to.transform] },
    {
      duration: entering ? 0.2 : 0.14,
      ease: entering ? [0.16, 1, 0.3, 1] : 'easeIn',
    },
  );
  const finish = () => {
    if (transitions.get(shell)?.animation !== animation) return;
    cancel(shell);
    complete();
  };
  // why: cleanup must also complete when an animation timeline stops advancing.
  const timer = setTimeout(finish, entering ? 250 : 190);
  transitions.set(shell, { animation, timer });
  void animation.finished.then(finish, () => {});
}

/** Reusing a shell cancels its pending exit without replaying its entrance. */
export function showSurface(shell: HTMLElement) {
  const entering = shell.hidden || !shell.dataset.phase;
  cancel(shell);
  shell.removeAttribute('hidden');
  shell.removeAttribute('inert');
  shell.removeAttribute('aria-hidden');
  shell.style.opacity = '';
  shell.style.transform = '';
  if (entering) transition(shell, true, () => {});
}

/** Controls stop accepting input immediately; visual cleanup waits for the exit. */
export function hideSurface(
  shell: HTMLElement,
  complete = () => {
    shell.setAttribute('hidden', '');
  },
) {
  shell.setAttribute('inert', '');
  shell.setAttribute('aria-hidden', 'true');
  transition(shell, false, complete);
}

/** A dialog's entrance: the scrim fades while the panel rises a few pixels. Reduced motion shows both at rest. */
export function enterDialog(backdrop: HTMLElement, box: HTMLElement) {
  if (typeof box.animate !== 'function' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches))
    return;
  animate([backdrop], { opacity: [0, 1] }, { duration: 0.16, ease: 'easeOut' });
  animate([box], { opacity: [0, 1], transform: ['translateY(6px) scale(.98)', 'none'] }, { duration: 0.2, ease: [0.16, 1, 0.3, 1] });
}

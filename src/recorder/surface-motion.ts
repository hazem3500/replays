export type FloatingSurface = {
  host: HTMLElement;
  root: ShadowRoot;
  remove: () => void;
  shell: HTMLElement;
  content: HTMLElement;
  live: HTMLElement;
  label: HTMLElement;
};

const transitions = new WeakMap<HTMLElement, { animation: Animation; timer: ReturnType<typeof setTimeout> }>();
const resting = { opacity: 1, transform: 'translateX(-50%) translateY(0) scale(1)' };
const away = { opacity: 0, transform: 'translateX(-50%) translateY(8px) scale(.98)' };

function cancel(shell: HTMLElement) {
  const previous = transitions.get(shell);
  transitions.delete(shell);
  if (previous) {
    clearTimeout(previous.timer);
    previous.animation.cancel();
  }
}

function transition(shell: HTMLElement, entering: boolean, complete: () => void) {
  cancel(shell);
  if (typeof shell.animate !== 'function' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    complete();
    return;
  }
  const animation = shell.animate(entering ? [away, resting] : [resting, away], {
    duration: entering ? 200 : 140,
    easing: entering ? 'cubic-bezier(.16, 1, .3, 1)' : 'ease-in',
    fill: 'both',
  });
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
  shell.hidden = false;
  shell.inert = false;
  shell.removeAttribute('aria-hidden');
  if (entering) transition(shell, true, () => {});
}

/** Controls stop accepting input immediately; visual cleanup waits for the exit. */
export function hideSurface(
  shell: HTMLElement,
  complete = () => {
    shell.hidden = true;
  },
) {
  shell.inert = true;
  shell.setAttribute('aria-hidden', 'true');
  transition(shell, false, complete);
}

import { useLayoutEffect, useRef } from 'react';

const DROP_MS = 240;
const RETURN_MS = 300;
const EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

interface Snapshot {
  still: HTMLElement;
  frontId: string | undefined;
  poses: string[];
  opacities: number[];
}

type Animate = (target: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => Animation;

function stackParts(container: HTMLElement | null, view: string | undefined) {
  const stage = container?.querySelector<HTMLElement>(view === 'grid' ? '.shuffle-window' : '.poster-stack');
  const front = stage?.querySelector<HTMLElement>(view === 'grid' ? ':scope > .poster:not(.poster-outgoing)' : '.stack-front');
  const poster = view === 'grid' ? front : front?.querySelector<HTMLElement>(':scope > .poster');
  const backs = stage
    ? [...stage.querySelectorAll<HTMLElement>(':scope > .card-back, :scope > .stack-layer')].sort(
        (a, b) => Number(a.dataset.stackDepth) - Number(b.dataset.stackDepth),
      )
    : [];
  return { stage, front, poster, backs };
}

/** Moves thumbnail planes through their actual stack poses without moving the card's information. */
export function useShuffle(container: React.RefObject<HTMLElement | null>, step: number, view?: string) {
  const previous = useRef(step);
  const outgoing = useRef<Snapshot | undefined>(undefined);
  const capture = () => {
    const { front, poster, backs } = stackParts(container.current, view);
    if (!front || !poster) return;
    const still = poster.cloneNode(true);
    if (!(still instanceof HTMLElement)) return;
    still.inert = true;
    for (const video of still.querySelectorAll('video')) video.remove();
    still.setAttribute('aria-hidden', 'true');
    still.classList.add('poster-outgoing');
    Object.assign(still.style, {
      position: 'absolute',
      left: `${front.offsetLeft}px`,
      top: `${front.offsetTop}px`,
      width: `${front.offsetWidth}px`,
      height: `${front.offsetHeight}px`,
      transformOrigin: '50% 0',
      zIndex: '9',
    });
    outgoing.current?.still.remove();
    outgoing.current = {
      still,
      frontId: container.current?.dataset.stackFront,
      poses: backs.map((back) => getComputedStyle(back).transform),
      opacities: backs.map((back) => Number(getComputedStyle(back).opacity || '1')),
    };
  };

  useLayoutEffect(() => {
    const was = previous.current;
    previous.current = step;
    const snapshot = outgoing.current;
    outgoing.current = undefined;
    const { stage, front, backs } = stackParts(container.current, view);
    if (!stage || !front || step <= was || !snapshot) {
      snapshot?.still.remove();
      return;
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      snapshot.still.remove();
      return;
    }
    return animateShuffle(stage, front, backs, snapshot);
  }, [container, step, view]);

  return capture;
}

/** Keeps the return and each rear plane on one cancellable timeline. */
function animateShuffle(stage: HTMLElement, front: HTMLElement, backs: HTMLElement[], snapshot: Snapshot) {
  const { still, poses, opacities, frontId } = snapshot;
  const animations: Animation[] = [];
  const returned = backs.find((back) => back.dataset.runId === frontId);
  const rear = getComputedStyle(returned ?? backs.at(-1) ?? front);
  const rearPose = rear.transform;
  const rearOpacity = Number(rear.opacity || '1');
  let active = true;
  const animate = (target: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    const animation = target.animate(frames, options);
    animations.push(animation);
    void animation.finished.catch(() => undefined);
    return animation;
  };
  stage.append(still);
  front.style.setProperty('transform-origin', '50% 0');
  if (returned) returned.style.visibility = 'hidden';
  const dropped = `translateY(${front.offsetHeight + 24}px)`;
  const down = animate(still, [{ transform: 'none' }, { transform: dropped }], {
    duration: DROP_MS,
    easing: EASE,
    fill: 'forwards',
  });
  animate(
    front,
    [
      { transform: poses[0] ?? 'none', opacity: opacities[0] ?? 1 },
      { transform: 'none', opacity: 1 },
    ],
    {
      duration: DROP_MS + 80,
      easing: EASE,
      fill: 'backwards',
    },
  );
  animateBacks(backs, snapshot, returned, animate);
  void down.finished
    .then(async () => {
      if (!active) return;
      // why: the old front changes depth only while it is fully hidden below the information area.
      still.style.zIndex = '0';
      const returning = animate(
        still,
        [
          { transform: dropped, opacity: 1 },
          { transform: rearPose, opacity: rearOpacity },
        ],
        {
          duration: RETURN_MS,
          easing: EASE,
          fill: 'forwards',
        },
      );
      down.cancel();
      await returning.finished;
      if (!active) return;
      returned?.style.removeProperty('visibility');
      still.remove();
    })
    .catch(() => undefined);
  return () => {
    active = false;
    for (const animation of animations) animation.cancel();
    front.style.removeProperty('transform-origin');
    returned?.style.removeProperty('visibility');
    still.remove();
  };
}

/** Carries rear sheets from their previous depth while the returning sheet and buried reserve stay hidden. */
function animateBacks(backs: HTMLElement[], snapshot: Snapshot, returned: HTMLElement | undefined, animate: Animate) {
  const { poses, opacities } = snapshot;
  for (const [index, back] of backs.entries()) {
    if (back === returned || back.hasAttribute('data-stack-reserve')) continue;
    const target = getComputedStyle(back);
    // why: an unexposed sheet starts underneath the deepest visible plane, never at the front.
    const from = poses[index + 1] ?? `${poses.at(-1) === 'none' ? '' : (poses.at(-1) ?? '')} scale(0.96)`;
    animate(
      back,
      [
        { transform: from, opacity: opacities[index + 1] ?? 0 },
        { transform: target.transform, opacity: Number(target.opacity || '1') },
      ],
      {
        duration: DROP_MS + 80,
        easing: EASE,
        fill: 'backwards',
      },
    );
  }
}

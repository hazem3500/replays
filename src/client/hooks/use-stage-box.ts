import { type RefObject, useLayoutEffect, useState } from 'react';

/** How long after the last size change the stage still counts as resizing. */
const SETTLE_MS = 160;

export interface StageBox {
  width: number;
  height: number;
  /** The box changed size within the last moment (a window or panel resize): tiles follow it without gliding. */
  resizing: boolean;
}

/** The stage's content box, kept current as it resizes; zero until it is measured. */
export function useStageBox(element: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState<StageBox>({ width: 0, height: 0, resizing: false });
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    let measured = false;
    let timer = 0;
    const settle = () => setBox((current) => (current.resizing ? { ...current, resizing: false } : current));
    const measure = () => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      const resizing = measured;
      measured = true;
      setBox((current) => (current.width === width && current.height === height ? current : { width, height, resizing }));
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, SETTLE_MS);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [element]);
  return box;
}

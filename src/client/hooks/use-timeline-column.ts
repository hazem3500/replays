import { useEffect, useMemo, useState } from 'react';

import { buildScale } from '../editor/timeline/scale.ts';

/**
 * The timeline's track column and its scale. The column is held in state (a callback ref), so the scale is rebuilt
 * once it exists and whenever it resizes.
 */
export function useTimelineColumn(duration: number) {
  const [column, setColumn] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!column) return;
    const measure = () => setWidth(column.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    return () => observer.disconnect();
  }, [column]);
  const scale = useMemo(() => buildScale(column, width, duration), [column, width, duration]);
  return { setColumn, scale };
}

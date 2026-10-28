import { useEffect, useRef } from 'react';

/** A ref that always holds the last committed `value`, for listeners and drags that outlive a render. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

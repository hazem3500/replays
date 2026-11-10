import { useEffect, useState } from 'react';

/** True once `ms` have passed since mount: a wait that ends sooner never shows its placeholder. */
export function useDelayedVisible(ms: number) {
  const [visible, setVisible] = useState(ms <= 0);
  useEffect(() => {
    if (ms <= 0) return;
    const timer = setTimeout(() => setVisible(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return visible;
}

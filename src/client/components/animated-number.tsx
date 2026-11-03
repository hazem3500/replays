import { cn } from '@/lib/utils.ts';

import { useNumberMotion } from '../hooks/use-number-motion.ts';
import { numberText } from './number-parts.ts';

/** Native formatted text stays accessible; discrete changes add a temporary, decorative digit roll. */
export function AnimatedNumber({ value, className, instant = false }: { value: number; className?: string; instant?: boolean }) {
  const text = numberText(value);
  const wrapper = useNumberMotion(value, text, instant);
  return (
    <span ref={wrapper} className={cn('animated-number', className)}>
      <span className="number-static">{text}</span>
      <span className="number-motion" aria-hidden="true" />
    </span>
  );
}

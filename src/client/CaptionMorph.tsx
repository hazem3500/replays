import { useMediaQuery } from './media.ts';

/**
 * The caption's text inside one persistent host. A change swaps the whole line (it fades and rises in, step-caption.css)
 * rather than morphing per character: captions change on every seek, and the character morph cost ~49 kB gzip plus
 * ~2 s of main-thread work across 40 rapid retargets at 4× CPU (perf audit, 2026-10-27).
 */
export function CaptionMorph({ text }: { text: string }) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  return (
    <span className="caption-morph" data-caption-morph="" data-motion={reducedMotion ? 'reduced' : 'full'}>
      <span key={text} className="caption-swap" data-caption-text="">
        {text}
      </span>
    </span>
  );
}

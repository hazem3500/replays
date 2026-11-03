import { useMediaQuery } from './media.ts';
import { useCaptionTextMotion } from './hooks/use-caption-motion.ts';

/**
 * The caption's text inside one persistent host. Motion fades and raises the whole line on a change,
 * rather than morphing per character: captions change on every seek, and the character morph cost ~49 kB gzip plus
 * ~2 s of main-thread work across 40 rapid retargets at 4× CPU (perf audit, 2026-10-27).
 */
export function CaptionMorph({ text }: { text: string }) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  return (
    <span className="caption-morph" data-caption-morph="" data-motion={reducedMotion ? 'reduced' : 'full'}>
      <CaptionLine key={text} text={text} reducedMotion={reducedMotion} />
    </span>
  );
}

function CaptionLine({ text, reducedMotion }: { text: string; reducedMotion: boolean }) {
  const ref = useCaptionTextMotion(reducedMotion);
  return (
    <span ref={ref} className="caption-swap" data-caption-text="">
      {text}
    </span>
  );
}

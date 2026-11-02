import { lazy, Suspense } from 'react';

import { useTitleHydrated } from '../hooks/use-title-morph.ts';
import { useMediaQuery } from '../media.ts';

const MorphCharacters = lazy(() => import('./title-morph-characters.tsx'));

/** Morphs a title without exposing outgoing characters to the heading or menu's accessible name. */
export function TitleMorph({ text, from }: { text: string; from?: string | undefined }) {
  const hydrated = useTitleHydrated();
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  if (!hydrated || reduced)
    return (
      <span data-title-morph="" data-motion="reduced">
        {text}
      </span>
    );
  return (
    <span data-title-morph="" data-motion="full">
      <span className="visually-hidden">{text}</span>
      <Suspense fallback={<span aria-hidden="true">{text}</span>}>
        <MorphCharacters text={text} from={from} />
      </Suspense>
    </span>
  );
}

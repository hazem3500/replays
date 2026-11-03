import { animate } from 'motion/mini';
import { useLayoutEffect, type RefObject } from 'react';

const CONTENT = '.editor-stage .replayer-wrapper, .editor-presentation > *, .editor-dock .timeline, .phone-timeline, .editor-add-toolbar';

/** Late player mounts and inspector replacements use the same fade as the editor's initial content. */
export function useEditorArrival(shell: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const root = shell.current;
    if (!root || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const seen = new WeakSet<Element>();
    const controls = new Set<ReturnType<typeof animate>>();
    const reveal = () => {
      for (const node of root.querySelectorAll<HTMLElement>(CONTENT)) {
        if (seen.has(node)) continue;
        seen.add(node);
        if (typeof node.animate !== 'function') continue;
        const animation = animate([node], { opacity: [0.55, 1] }, { duration: 0.2, ease: [0.23, 1, 0.32, 1] });
        controls.add(animation);
        void animation.then(
          () => {
            controls.delete(animation);
          },
          () => {
            controls.delete(animation);
          },
        );
      }
    };
    reveal();
    const observer = new MutationObserver(reveal);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const animation of controls) animation.stop();
    };
  }, [shell]);
}

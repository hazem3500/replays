import { animate } from 'motion/mini';

import type { Replayer } from 'rrweb';

/** A read-only outline over the current replay document, never the host application's DOM. */
export class TargetOutline {
  private element: HTMLElement | undefined;
  private animation: ReturnType<typeof animate> | undefined;

  show(replayer: Replayer | undefined, selector: string, sameDocument: boolean) {
    const document = replayer?.iframe.contentDocument;
    if (!replayer || !document || !sameDocument) {
      this.clear();
      return 0;
    }
    let matches: Element[];
    try {
      matches = Array.from(document.querySelectorAll(selector));
    } catch {
      matches = [];
    }
    const first = matches.find((element) => element.getBoundingClientRect().width > 0 || element.getBoundingClientRect().height > 0);
    if (!first) {
      this.clear();
      return 0;
    }
    const box = first.getBoundingClientRect();
    let outline = this.element;
    if (!outline || !outline.isConnected) {
      outline = replayer.wrapper.ownerDocument.createElement('div');
      outline.className = 'target-outline';
      outline.setAttribute('aria-hidden', 'true');
      outline.dataset.testid = 'target-outline';
      outline.style.opacity = '0';
      outline.style.scale = '0.98';
      replayer.wrapper.append(outline);
      this.element = outline;
    }
    outline.style.transform = `translate(${box.left}px, ${box.top}px)`;
    outline.style.width = `${box.width}px`;
    outline.style.height = `${box.height}px`;
    const entering = !outline.hasAttribute('data-visible');
    outline.dataset.visible = '';
    if (entering) this.fade(true);
    return matches.length;
  }

  private fade(visible: boolean) {
    const node = this.element;
    if (!node) return;
    this.animation?.stop();
    this.animation = undefined;
    const reduced = node.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof node.animate !== 'function') {
      node.style.opacity = visible ? '1' : '0';
      node.style.scale = visible ? '1' : '0.98';
      return;
    }
    this.animation = animate([node], { opacity: visible ? 1 : 0, scale: visible ? 1 : 0.98 }, { duration: 0.16, ease: 'easeOut' });
  }

  destroy() {
    this.animation?.cancel();
    this.animation = undefined;
    this.element?.remove();
    this.element = undefined;
  }

  clear() {
    if (!this.element?.hasAttribute('data-visible')) return;
    delete this.element.dataset.visible;
    this.fade(false);
  }
}

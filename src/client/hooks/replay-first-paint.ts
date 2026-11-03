/** why: a hung resource must not trap playback behind its still; this matches the export renderer's asset budget. */
const ASSET_WAIT_MS = 4000;
const RESOURCES = 'img, link[rel~="stylesheet"]';

function untilAbort(work: PromiseLike<unknown>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      signal.removeEventListener('abort', finish);
      resolve();
    };
    void Promise.resolve(work).then(finish, finish);
    if (signal.aborted) {
      finish();
      return;
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}

function loaded(element: Element, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      element.removeEventListener('load', finish);
      element.removeEventListener('error', finish);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    if (signal.aborted) {
      finish();
      return;
    }
    element.addEventListener('load', finish, { once: true });
    element.addEventListener('error', finish, { once: true });
    signal.addEventListener('abort', finish, { once: true });
  });
}

async function imageReady(image: HTMLImageElement, signal: AbortSignal) {
  if (!image.complete) await loaded(image, signal);
  if (signal.aborted || !image.naturalWidth || typeof image.decode !== 'function') return;
  try {
    await untilAbort(image.decode(), signal);
  } catch {
    /* why: a failed decode is a settled image, not a reason to retain the cover. */
  }
}

function resourceNode(node: Node, document: Document) {
  const ElementType = document.defaultView?.Element;
  if (!ElementType || !(node instanceof ElementType)) return false;
  return node.matches(RESOURCES) || Boolean(node.querySelector(RESOURCES));
}

function resourcesChanged(records: MutationRecord[], document: Document, html: Element | null) {
  if (document.documentElement !== html) return true;
  return records.some((record) => {
    if (record.type === 'attributes') return true;
    return [...record.addedNodes, ...record.removedNodes].some((node) => resourceNode(node, document));
  });
}

async function settleDocument(document: Document, signal: AbortSignal) {
  const attempt = new AbortController();
  const abort = () => attempt.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) attempt.abort();
  const html = document.documentElement;
  const observer = new MutationObserver((records) => {
    if (resourcesChanged(records, document, html)) attempt.abort();
  });
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'href'] });
  try {
    const styles = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')].filter(
      (link) => !link.disabled && link.href && !link.sheet,
    );
    await Promise.all(styles.map((link) => loaded(link, attempt.signal)));
    await Promise.all([...document.querySelectorAll('img')].map((image) => imageReady(image, attempt.signal)));
    if (document.fonts) await untilAbort(document.fonts.ready, attempt.signal);
    return !attempt.signal.aborted;
  } finally {
    observer.disconnect();
    signal.removeEventListener('abort', abort);
  }
}

function paint(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let frame = 0;
    const finish = () => {
      cancelAnimationFrame(frame);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    if (signal.aborted) {
      finish();
      return;
    }
    signal.addEventListener('abort', finish, { once: true });
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(finish);
    });
  });
}

/** Keeps an opening still until the current rebuilt document's resources have settled and crossed a paint boundary. */
export async function waitForReplayPaint(root: HTMLElement, signal: AbortSignal) {
  const deadline = new AbortController();
  const abort = () => deadline.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) deadline.abort();
  const timer = window.setTimeout(abort, ASSET_WAIT_MS);
  try {
    while (!deadline.signal.aborted) {
      const document = root.querySelector('iframe')?.contentDocument;
      if (!document?.body) {
        await paint(deadline.signal);
        continue;
      }
      const html = document.documentElement;
      if (!(await settleDocument(document, deadline.signal))) continue;
      await paint(deadline.signal);
      if (root.querySelector('iframe')?.contentDocument !== document || document.documentElement !== html) continue;
      if ([...document.querySelectorAll('img')].some((image) => !image.complete) || document.fonts?.status === 'loading') continue;
      return;
    }
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

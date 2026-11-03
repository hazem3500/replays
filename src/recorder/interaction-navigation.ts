type Subscriber = () => void;

type NavigationCapture = { subscribers: Set<Subscriber>; release: () => void };

let current: NavigationCapture | undefined;

function install(): NavigationCapture {
  const subscribers = new Set<Subscriber>();
  const notify = () => {
    for (const subscriber of Array.from(subscribers)) subscriber();
  };
  // why: retain exact method identities for restoration; wrappers supply the receiver with apply.
  const originalPush = Reflect.get(history, 'pushState');
  const originalReplace = Reflect.get(history, 'replaceState');
  const push: History['pushState'] = function (this: History, ...args) {
    originalPush.apply(this, args);
    notify();
  };
  const replace: History['replaceState'] = function (this: History, ...args) {
    originalReplace.apply(this, args);
    notify();
  };
  history.pushState = push;
  history.replaceState = replace;
  window.addEventListener('popstate', notify);
  window.addEventListener('hashchange', notify);
  return {
    subscribers,
    release() {
      window.removeEventListener('popstate', notify);
      window.removeEventListener('hashchange', notify);
      if (history.pushState === push) history.pushState = originalPush;
      if (history.replaceState === replace) history.replaceState = originalReplace;
    },
  };
}

/** Shares one History API hook until the last recorder unsubscribes, without overwriting later host hooks. */
export function subscribeInteractionNavigation(subscriber: Subscriber): () => void {
  const capture = (current ??= install());
  capture.subscribers.add(subscriber);
  return () => {
    if (!capture.subscribers.delete(subscriber) || capture.subscribers.size > 0) return;
    capture.release();
    if (current === capture) current = undefined;
  };
}

const ignore = (_reason?: unknown) => {};

/** A deferred completion without requiring ES2024 Promise helpers in viewer hosts. */
export function deferred() {
  let resolve: () => void = ignore;
  let reject: (reason?: unknown) => void = ignore;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

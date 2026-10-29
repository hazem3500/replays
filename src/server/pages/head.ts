/**
 * The `<head>` of the stamped index.html (index-page.ts) without the SPA's own bundle (its module script, modulepreloads
 * and stylesheet): the deployment's metas, icons and inline scripts, added to every Start page so the client reads the
 * same `<meta name="app-*">` tags and paints the same theme before hydration.
 */
export function shellHead(indexHtml: string) {
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(indexHtml)?.[1] ?? '';
  return head
    .replace(/<script\b[^>]*\btype="module"[^>]*><\/script>\s*/gi, '')
    .replace(/<link\b[^>]*\brel="(?:modulepreload|stylesheet)"[^>]*>\s*/gi, '')
    .replace(/<!--[\s\S]*?-->\s*/g, '')
    .trim();
}

/** Inserts `head` right after the document's opening `<head>` tag, once, across streamed chunks. */
export function headInjector(head: string) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';
  let done = false;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (done) {
        controller.enqueue(chunk);
        return;
      }
      pending += decoder.decode(chunk, { stream: true });
      const open = /<head[^>]*>/i.exec(pending);
      if (!open) return;
      const at = open.index + open[0].length;
      controller.enqueue(encoder.encode(`${pending.slice(0, at)}${head}${pending.slice(at)}`));
      pending = '';
      done = true;
    },
    flush(controller) {
      if (pending) controller.enqueue(encoder.encode(pending));
    },
  });
}

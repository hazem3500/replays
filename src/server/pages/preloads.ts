import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

interface Chunk {
  file: string;
  name?: string;
  imports?: string[];
  css?: string[];
}

type Manifest = Record<string, Chunk>;

/** Older distributions without a client manifest retain their existing Start preloads. */
export async function loadPagePreloads(entryFile: string) {
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(resolve(dirname(entryFile), '../client/.vite/manifest.json'), 'utf8')) as Manifest;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return () => [] as string[];
    throw error;
  }
  return (url: string, base: string, metas: Readonly<Record<string, string>>) => {
    const pathname = new URL(url, 'http://replays.invalid').pathname;
    if (base && pathname !== base && !pathname.startsWith(`${base}/`)) return [];
    const path = pathname.slice(base.length) || '/';
    const names = pageChunks(path, metas);
    const files = new Set<string>();
    const visited = new Set<string>();
    function visit(key: string) {
      if (visited.has(key)) return;
      visited.add(key);
      const chunk = manifest[key];
      if (!chunk) return;
      if (chunk.file.endsWith('.js')) files.add(`${base}/${chunk.file.replace(/^\.\//, '')}`);
      for (const css of chunk.css ?? []) files.add(`${base}/${css.replace(/^\.\//, '')}`);
      for (const dependency of chunk.imports ?? []) visit(dependency);
    }
    for (const [key, chunk] of Object.entries(manifest)) if (names.includes(chunk.name ?? '')) visit(key);
    return [...files];
  };
}

function pageChunks(path: string, metas: Readonly<Record<string, string>>) {
  if (/^\/(?:r\/?)?$/.test(path)) return ['ReplayIndex', 'routes'];
  if (/^\/r\/[^/]+\/edit\/?$/.test(path)) {
    return metas['app-editing'] !== 'off' && metas['app-beta']?.split(/\s+/).includes('editor') ? ['Editor', 'r._id.edit'] : [];
  }
  if (/^\/r\/[^/]+\/?$/.test(path)) return ['Viewer', 'r._id.index'];
  if (/^\/s\/[^/]+(?:\/r\/[^/]+)?\/?$/.test(path)) return ['SuiteWorkspace', 'Viewer'];
  return [];
}

const attribute = (tag: string, name: string) => new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(tag)?.[1];
const escapeAttribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

/** Warms current-route scripts and styles without duplicating Start's hints or buffering its streamed body. */
export function pagePreloadInjector(urls: readonly string[]) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';
  let done = false;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (done) {
        controller.enqueue(encoder.encode(decoder.decode(chunk, { stream: true })));
        return;
      }
      pending += decoder.decode(chunk, { stream: true });
      const close = /<\/head\s*>/i.exec(pending);
      if (!close) return;
      const wanted = new Set(urls.map(escapeAttribute));
      const head = pending.slice(0, close.index).replace(/<link\b[^>]*>/gi, (tag) => {
        if (attribute(tag, 'rel') !== 'modulepreload' || !wanted.has(attribute(tag, 'href') ?? '')) return tag;
        const priority = tag.replace(/\sfetchpriority=["'][^"']*["']/gi, '');
        const credentials = /\bcrossorigin\b/i.test(priority) ? '' : ' crossorigin';
        return priority.replace(/\s*\/?>$/, `${credentials} fetchpriority="high">`);
      });
      const existing = new Set(
        [...head.matchAll(/<link\b[^>]*>/gi)]
          .filter(
            ([tag]) =>
              ['modulepreload', 'stylesheet'].includes(attribute(tag, 'rel') ?? '') ||
              (attribute(tag, 'rel') === 'preload' && attribute(tag, 'as') === 'style'),
          )
          .map(([tag]) => attribute(tag, 'href')),
      );
      const links = [...new Set(urls)]
        .map(escapeAttribute)
        .filter((url) => !existing.has(url))
        .map((url) => {
          const attributes = url.endsWith('.css') ? 'rel="preload" as="style"' : 'rel="modulepreload"';
          return `<link ${attributes} crossorigin fetchpriority="high" href="${url}">`;
        })
        .join('');
      controller.enqueue(encoder.encode(`${head}${links}${pending.slice(close.index)}`));
      pending = '';
      done = true;
    },
    flush(controller) {
      controller.enqueue(encoder.encode(pending + decoder.decode()));
    },
  });
}

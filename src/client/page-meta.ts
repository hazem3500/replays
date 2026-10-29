type MetaReader = (name: string) => string | undefined;

let serverMeta: MetaReader | undefined;

/** On a Start server: `<meta>` contents come from the request's stamped head (start/router.tsx sets the reader). */
export function setServerMeta(read: MetaReader) {
  serverMeta = read;
}

/**
 * The content of `<meta name="…">` the server stamped into the page (src/server/index-page.ts): from the document in
 * the browser, from the request being rendered on a server, undefined without either (unit tests).
 */
export function pageMeta(name: string): string | undefined {
  if (typeof document !== 'undefined') return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content;
  return serverMeta?.(name);
}

type CookieReader = () => string;

let serverCookie: CookieReader | undefined;

/** On a Start server: the request's `Cookie` header (start/router.tsx sets the reader). */
export function setServerCookie(read: CookieReader) {
  serverCookie = read;
}

/** A cookie of this page: the document's in the browser, the request's on a server render. */
export function pageCookie(name: string): string | undefined {
  const header = typeof document !== 'undefined' ? document.cookie : (serverCookie?.() ?? '');
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

/** Mirrors a display preference into a cookie, so a server render shows what this browser will (a year, this app only). */
export function writePageCookie(name: string, value: string, base: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=${base || '/'}; max-age=31536000; samesite=lax`;
}

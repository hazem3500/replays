let override: boolean | undefined;

/**
 * Whether user plugins are on (server: `REPLAYS_BETA_MALLEABLE=true` / `beta.malleable`). The server writes it into index.html
 * (`<meta name="app-beta" content="… malleable">`); off by default. With it off the viewer shows no plugin UI, loads none of
 * this directory's code, opens no bridge and registers no WebMCP tools.
 */
export function betaMalleable() {
  if (override !== undefined) return override;
  if (typeof document === 'undefined') return false;
  const content = document.querySelector<HTMLMetaElement>('meta[name="app-beta"]')?.content ?? '';
  return content.split(/[\s,]+/).includes('malleable');
}

/** Tests only. */
export function setBetaMalleableForTests(value: boolean | undefined) {
  override = value;
}

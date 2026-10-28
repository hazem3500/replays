import { betaEnabledAtLoad } from '../settings/labs.ts';

let override: boolean | undefined;

/**
 * Whether user plugins are on in this page: the server allows them (`REPLAYS_BETA_MALLEABLE=true` / `beta.malleable`, written
 * into index.html as `<meta name="app-beta" content="… malleable">`; off by default) and this person has not opted out under
 * Settings › Labs (src/shared/beta-flags.ts). With it off the viewer shows no plugin UI, loads none of this directory's
 * code, opens no bridge and registers no WebMCP tools. The plugins boot with the page, so the value is fixed at load: a Labs
 * change applies after a reload.
 */
export function betaMalleable() {
  if (override !== undefined) return override;
  if (typeof document === 'undefined') return false;
  return betaEnabledAtLoad('malleable');
}

/** Tests only. */
export function setBetaMalleableForTests(value: boolean | undefined) {
  override = value;
}

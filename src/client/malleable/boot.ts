import { loadHost } from './host.ts';
import { manager } from './manager.ts';
import { installWebMcp } from './webmcp.ts';

/**
 * Start-up for beta.malleable: reads the host's policy and versions, loads the person's saved plugins and registers the
 * WebMCP tools. Failures are logged, never thrown.
 */
export async function boot() {
  await loadHost();
  await installWebMcp().catch((error: unknown) => console.warn('WebMCP tools could not be installed:', error));
  await manager.loadSaved().catch((error: unknown) => console.error('user plugins could not be loaded:', error));
}

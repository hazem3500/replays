import { startServer } from '../scripts/test-server.mjs';

export default async function globalSetup() {
  // Posters and server-side video need a background Chromium and ffmpeg; the specs run against placeholders.
  const server = await startServer({ env: { POSTERS_DISABLED: '1', RENDER_DISABLED: '1' } });
  process.env.E2E_ORIGIN = server.origin;
  return () => server.stop();
}

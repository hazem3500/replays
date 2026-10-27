import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ReplaysCliConfig {
  version: 1;
  defaultServer: string;
  servers: Record<string, { url: string }>;
}

const DEFAULT_NAME = 'default';
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/;

export function configPath(env: NodeJS.ProcessEnv = process.env, platform = process.platform) {
  if (platform === 'win32') return join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'replays', 'config.json');
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'replays', 'config.json');
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'replays', 'config.json');
}

export function normalizeServerUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('server URL must be an absolute http(s) URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('server URL must use http or https');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('server URL must use HTTPS except on loopback');
  if (url.username || url.password || url.search || url.hash)
    throw new Error('server URL must not include credentials, query parameters, or a fragment');
  return url.href.replace(/\/+$/, '');
}

export function uploadEndpoint(serverUrl: string) {
  return `${normalizeServerUrl(serverUrl)}/api/replays`;
}

export function normalizeUploadUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('upload URL must be an absolute http(s) URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('upload URL must use http or https');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('upload URL must use HTTPS except on loopback');
  if (url.username || url.password || url.search || url.hash)
    throw new Error('upload URL must not include credentials, query parameters, or a fragment');
  return url.href.replace(/\/+$/, '');
}

/**
 * Resolve a CLI upload target. Integrations that attach credentials can supply `trustedUploadUrl` to
 * force the approved endpoint regardless of saved config; a conflicting explicit URL is refused.
 */
export async function resolveUploadEndpoint(options: {
  explicitUploadUrl?: string;
  explicitServerName?: string;
  trustedUploadUrl?: string;
  env?: NodeJS.ProcessEnv;
  path?: string;
}) {
  if (options.trustedUploadUrl) {
    const trusted = normalizeUploadUrl(options.trustedUploadUrl);
    if (options.explicitUploadUrl && normalizeUploadUrl(options.explicitUploadUrl) !== trusted)
      throw new Error('explicit upload URL does not match the trusted upload endpoint');
    return trusted;
  }
  if (options.explicitUploadUrl) return normalizeUploadUrl(options.explicitUploadUrl);
  const server = await resolveServerUrl({
    ...(options.explicitServerName ? { explicitName: options.explicitServerName } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.path ? { path: options.path } : {}),
  });
  return uploadEndpoint(server.url);
}

function emptyConfig(): ReplaysCliConfig {
  return { version: 1, defaultServer: DEFAULT_NAME, servers: {} };
}

export async function readCliConfig(path = configPath()): Promise<ReplaysCliConfig> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    const value = parsed as Partial<ReplaysCliConfig>;
    if (
      value.version !== 1 ||
      typeof value.defaultServer !== 'string' ||
      !value.servers ||
      typeof value.servers !== 'object' ||
      Array.isArray(value.servers)
    )
      throw new Error();
    const servers: ReplaysCliConfig['servers'] = {};
    for (const [name, entry] of Object.entries(value.servers)) {
      if (!NAME.test(name) || !entry || typeof entry.url !== 'string') throw new Error();
      servers[name] = { url: normalizeServerUrl(entry.url) };
    }
    if (Object.keys(servers).length && !servers[value.defaultServer]) throw new Error();
    return { version: 1, defaultServer: value.defaultServer, servers };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyConfig();
    throw new Error('saved CLI configuration is invalid; run `replays config reset` and connect again', { cause: error });
  }
}

export async function saveServer(url: string, name = DEFAULT_NAME, path = configPath()) {
  if (!NAME.test(name)) throw new Error('server name must be 1–40 letters, digits, dots, underscores, or hyphens');
  const serverUrl = normalizeServerUrl(url);
  const config = await readCliConfig(path);
  config.servers[name] = { url: serverUrl };
  config.defaultServer = name;
  await persist(config, path);
  return config;
}

export async function resetCliConfig(path = configPath()) {
  await rm(path, { force: true });
}

async function persist(config: ReplaysCliConfig, path: string) {
  const directory = join(path, '..');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700).catch(() => undefined);
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
    await chmod(path, 0o600).catch(() => undefined);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function resolveServerUrl(options: { explicitName?: string; env?: NodeJS.ProcessEnv; path?: string } = {}) {
  const env = options.env ?? process.env;
  if (options.explicitName) {
    const config = await readCliConfig(options.path);
    const server = config.servers[options.explicitName];
    if (!server)
      throw new Error(
        `no server named "${options.explicitName}" is configured; run \`replays connect <server-url> --name ${options.explicitName}\``,
      );
    return { name: options.explicitName, url: server.url, source: 'flag' as const };
  }
  if (env.REPLAYS_SERVER_URL)
    return { name: undefined, url: normalizeServerUrl(env.REPLAYS_SERVER_URL), source: 'REPLAYS_SERVER_URL' as const };
  const config = await readCliConfig(options.path);
  const name = env.REPLAYS_SERVER || config.defaultServer;
  const server = config.servers[name];
  if (!server) throw new Error(`no server named "${name}" is configured; run \`replays connect <server-url> --name ${name}\``);
  return { name, url: server.url, source: env.REPLAYS_SERVER ? ('REPLAYS_SERVER' as const) : ('saved' as const) };
}

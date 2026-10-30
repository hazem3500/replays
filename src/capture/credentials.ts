import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { configPath } from './server-config.ts';

export interface CachedCliToken {
  version: 1;
  server: string;
  issuer: string;
  clientId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

const keyFor = (server: string, issuer: string, clientId: string) =>
  createHash('sha256').update(`${server}\n${issuer}\n${clientId}`).digest('hex');
const credentialFile = (server: string, issuer: string, clientId: string, path = configPath()) =>
  join(dirname(path), 'credentials', `${keyFor(server, issuer, clientId)}.json`);

function run(command: string, args: string[], input?: string, timeoutMs = 10_000) {
  return new Promise<{ code: number; stdout: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 64 * 1024) child.kill();
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 1, stdout }));
    child.stdin.end(input ?? '');
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.once('close', () => clearTimeout(timer));
  });
}

/** Linux Secret Service when available; otherwise a separate owner-only credential file. */
async function keyring(operation: 'get' | 'put' | 'delete', key: string, value?: string) {
  if (process.env.REPLAYS_CREDENTIAL_STORE === 'file') return undefined;
  if (process.platform === 'darwin') {
    const script = `import Foundation\nimport Security\nlet a = CommandLine.arguments\nlet op = a[1]\nlet service = a[2]\nlet account = a[3]\nlet input = FileHandle.standardInput.readDataToEndOfFile()\nlet base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]\nif op == "get" { var q = base; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne; var item: CFTypeRef?; let s = SecItemCopyMatching(q as CFDictionary, &item); if s == errSecSuccess, let data = item as? Data { FileHandle.standardOutput.write(data); exit(0) }; exit(1) }\nif op == "put" { SecItemDelete(base as CFDictionary); var q = base; q[kSecValueData as String] = input; q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly; exit(SecItemAdd(q as CFDictionary, nil) == errSecSuccess ? 0 : 1) }\nif op == "delete" { let s = SecItemDelete(base as CFDictionary); exit(s == errSecSuccess || s == errSecItemNotFound ? 0 : 1) }\nexit(1)`;
    try {
      const result = await run('swift', ['-e', script, operation, 'replays-cli', key], value, 60_000);
      if (result.code === 0) return operation === 'get' ? result.stdout : '';
    } catch {
      // Swift is optional; on machines without its runtime use the owner-only file fallback.
    }
    return undefined;
  }
  if (process.platform !== 'linux') return undefined;
  const args =
    operation === 'get'
      ? ['lookup', 'service', 'replays-cli', 'account', key]
      : operation === 'delete'
        ? ['clear', 'service', 'replays-cli', 'account', key]
        : ['store', '--label=Replays CLI', 'service', 'replays-cli', 'account', key];
  try {
    const result = await run('secret-tool', args, operation === 'put' ? value : undefined);
    if (result.code === 0) return operation === 'get' ? result.stdout.trimEnd() : '';
  } catch {
    // secret-tool is optional. An absent or locked keyring uses the protected file fallback.
  }
  return undefined;
}

async function loadFile(file: string): Promise<string | undefined> {
  try {
    const info = await stat(file);
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new Error('credential file is not owned by this user');
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw new Error('credential file permissions are too broad');
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`cannot read CLI credentials safely (${(error as Error).message}); run replays logout and login again`, {
      cause: error,
    });
  }
}

export async function loadCliToken(server: string, issuer: string, clientId: string, path?: string) {
  const key = keyFor(server, issuer, clientId);
  const secret = await keyring('get', key);
  const contents = secret ?? (await loadFile(credentialFile(server, issuer, clientId, path)));
  if (!contents) return undefined;
  try {
    const value: unknown = JSON.parse(contents);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const token = value as CachedCliToken;
    if (
      token.version !== 1 ||
      token.server !== server ||
      token.issuer !== issuer ||
      token.clientId !== clientId ||
      typeof token.accessToken !== 'string' ||
      !token.accessToken ||
      typeof token.expiresAt !== 'number'
    )
      throw new Error();
    if (token.refreshToken !== undefined && typeof token.refreshToken !== 'string') throw new Error();
    return token;
  } catch {
    throw new Error('saved CLI credentials are invalid; run `replays logout` and `replays login` again');
  }
}

export async function saveCliToken(token: CachedCliToken, path?: string) {
  const contents = JSON.stringify(token);
  const file = credentialFile(token.server, token.issuer, token.clientId, path);
  const directory = dirname(file);
  const key = keyFor(token.server, token.issuer, token.clientId);
  const saved = await keyring('put', key, contents);
  if (saved !== undefined) {
    await rm(file, { force: true });
    return 'os-keyring' as const;
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700).catch(() => undefined);
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${contents}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
    await chmod(file, 0o600).catch(() => undefined);
  } finally {
    await rm(temporary, { force: true });
  }
  return 'owner-only-file' as const;
}

export async function deleteCliToken(server: string, issuer: string, clientId: string, path?: string) {
  const key = keyFor(server, issuer, clientId);
  await keyring('delete', key);
  await rm(credentialFile(server, issuer, clientId, path), { force: true });
}

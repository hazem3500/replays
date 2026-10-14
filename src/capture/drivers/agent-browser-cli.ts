import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string } | string | null;
}

export class AgentBrowser {
  readonly binary: string;
  readonly session: string;

  constructor(session: string, binary = process.env.AGENT_BROWSER_BIN ?? 'agent-browser') {
    this.session = session;
    this.binary = binary;
  }

  async command<T = Record<string, unknown>>(args: string[], json = true): Promise<T> {
    const fullArgs = ['--session', this.session, '--input-mode', 'human', ...(json ? ['--json'] : []), ...args];
    const { stdout } = await execFileAsync(this.binary, fullArgs, {
      maxBuffer: 20 * 1024 * 1024,
      env: process.env,
    });
    if (!json) return stdout as T;
    const line = stdout
      .trim()
      .split('\n')
      .findLast((candidate) => candidate.trim().startsWith('{'));
    if (!line) throw new Error(`agent-browser returned no JSON for ${args[0] ?? 'command'}`);
    const envelope = JSON.parse(line) as Envelope<T>;
    if (!envelope.success) {
      const message = typeof envelope.error === 'string' ? envelope.error : envelope.error?.message;
      throw new Error(message ?? `agent-browser ${args[0] ?? 'command'} failed`);
    }
    return envelope.data as T;
  }

  open(url: string) {
    return this.command(['open', url]);
  }

  async cdpUrl() {
    const data = await this.command<{ cdpUrl: string }>(['get', 'cdp-url']);
    if (!data.cdpUrl) throw new Error('agent-browser returned no CDP URL');
    return data.cdpUrl;
  }

  close() {
    return this.command(['close']).catch(() => undefined);
  }
}

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
  private state: string | undefined;
  /**
   * agent-browser applies `AGENT_BROWSER_STATE` on every command, and loading it again sends the session back to
   * `about:blank`. It is set on the launch command only: the cookies stay, and so does the page the last command opened.
   */
  private launched = false;

  constructor(session: string, binary = process.env.AGENT_BROWSER_BIN ?? 'agent-browser') {
    this.session = session;
    this.binary = binary;
  }

  /** A storage state file for the launch command (see `readStateFile`); the `AGENT_BROWSER_STATE` variable works too. */
  loadState(path: string | undefined) {
    this.state = path;
  }

  async command<T = Record<string, unknown>>(args: string[], json = true): Promise<T> {
    const fullArgs = ['--session', this.session, '--input-mode', 'human', ...(json ? ['--json'] : []), ...args];
    const env = { ...process.env };
    if (this.launched) delete env.AGENT_BROWSER_STATE;
    else if (this.state) env.AGENT_BROWSER_STATE = this.state;
    const { stdout } = await execFileAsync(this.binary, fullArgs, { maxBuffer: 20 * 1024 * 1024, env }).finally(() => {
      this.launched = true;
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

export function freePort(): Promise<number>;
export function startServer(options?: {
  env?: Record<string, string>;
  /** Keep the server's stdout/stderr for `output()`. */
  capture?: boolean;
}): Promise<{ origin: string; dataDir: string; output(): string; stop(): Promise<void> }>;

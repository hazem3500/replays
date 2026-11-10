/**
 * The commands that need the server's dependencies (the viewer runtime), kept out of the self-contained CLI bundle:
 * `scripts/build-cli.mjs` emits this file on its own, and `bin/replays.mjs` loads it only once those dependencies resolve.
 */
export async function runServerCommand(command: string, rest: string[], env: NodeJS.ProcessEnv) {
  switch (command) {
    case 'migrate':
      await (await import('./server/migrate-cli.ts')).runMigrateCli(rest);
      return;
    case 'plugin':
      if (rest[0] !== 'check') {
        process.stderr.write('usage: replays plugin check <file> [options]\n');
        process.exitCode = 2;
      } else await (await import('./plugin/check.ts')).runPluginCheckCli(rest.slice(1), env);
      return;
    case 'mcp':
      await (await import('./mcp/main.ts')).runMcpCli(rest);
      return;
    case 'build-static':
      await (await import('./server/static.ts')).runBuildStaticCli(rest);
      return;
    default:
      throw new Error(`not a server command: ${command}`);
  }
}

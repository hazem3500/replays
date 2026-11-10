/**
 * Connect GitHub: OFF unless both values are set.
 *
 *   REPLAYS_GITHUB_CLIENT_ID=<OAuth app client id>
 *   REPLAYS_GITHUB_CLIENT_SECRET=<OAuth app client secret>
 *
 * Set, the viewer's account menu offers "Connect GitHub" to a signed-in person who has an email, and the login they
 * verify counts as a handle the server vouches for (like `api.identity` handles). Unset, the feature has no routes and no UI.
 * The secret is read from the environment only, never from the config file.
 */
export interface GithubConnectSettings {
  clientId: string;
  clientSecret: string;
}

export function githubConnectFromEnv(env: Record<string, string | undefined>): GithubConnectSettings | undefined {
  const clientId = env.REPLAYS_GITHUB_CLIENT_ID?.trim();
  const clientSecret = env.REPLAYS_GITHUB_CLIENT_SECRET?.trim();
  if (!clientId && !clientSecret) return undefined;
  if (!clientId || !clientSecret) throw new Error('Connect GitHub needs both REPLAYS_GITHUB_CLIENT_ID and REPLAYS_GITHUB_CLIENT_SECRET');
  return { clientId, clientSecret };
}

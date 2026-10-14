# Signed-header auth (example plugin)

Some deployments put an identity-aware proxy or API gateway in front of the app. After it signs a user in, it
forwards a short-lived signed token (a JWT) in a request header and publishes its public keys at a JWKS URL. This
plugin verifies that token on every request — signature (ES256 or RS256), issuer, audience, expiry — and uses the
email claim as the identity.

It is a **plugin**, not part of the core: the core ships `none`, `header` (trusted proxy) and `oidc`. A plugin is
any module whose default export is `(env) => AuthAdapter`; see `src/server/auth/types.ts`.

```bash
AUTH_MODE=plugin \
AUTH_PLUGIN=./examples/auth-signed-header/plugin.mjs \
SIGNED_HEADER_NAME=x-signed-identity \
SIGNED_HEADER_JWKS_URL=https://idp.example.com/.well-known/jwks.json \
SIGNED_HEADER_ISSUER=https://idp.example.com \
SIGNED_HEADER_AUDIENCE=replay-kit \
SIGNED_HEADER_ALLOW=@example.com \
pnpm start
```

| Variable | Meaning |
| --- | --- |
| `SIGNED_HEADER_NAME` | Header that carries the token (default `x-signed-identity`) |
| `SIGNED_HEADER_JWKS_URL` | Where the proxy publishes its public keys |
| `SIGNED_HEADER_ISSUER` | Required `iss` claim |
| `SIGNED_HEADER_AUDIENCE` | Required `aud` claim |
| `SIGNED_HEADER_ALLOW` | Optional allow-list: `@domain` suffixes or exact emails |
| `SIGNED_HEADER_EMAIL_CLAIM` | Claim to read the email from (default `email`) |

In Docker, mount the file and point `AUTH_PLUGIN` at the mounted path. Machine uploaders (CI) must either pass
through the proxy too, or you run a second listener behind a different adapter — the app has one adapter per
process.

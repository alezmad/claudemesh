# OAuth setup

claudemesh supports GitHub and Google sign-in via BetterAuth. Both providers are wired but inert until you supply credentials.

## 1. GitHub OAuth app

Create a new OAuth app at <https://github.com/settings/developers> → **New OAuth App**:

| Field | Value |
|---|---|
| Application name | claudemesh |
| Homepage URL | `https://claudemesh.com` |
| Authorization callback URL | `https://claudemesh.com/api/auth/callback/github` |

For local development, register a **second** OAuth app with `http://localhost:3000/api/auth/callback/github` as the callback, or add both callbacks to one app if GitHub allows (it does — callback URLs accept a newline-separated list).

Copy the **Client ID** and generate a **Client Secret**, then put them in `apps/web/.env.local`:

```env
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## 2. Google OAuth client

Open <https://console.cloud.google.com/apis/credentials> and either reuse an existing OAuth 2.0 Client ID or create a new one (type: **Web application**).

Add authorized redirect URIs:

- `https://claudemesh.com/api/auth/callback/google`
- `http://localhost:3000/api/auth/callback/google`

Add authorized JavaScript origins:

- `https://claudemesh.com`
- `http://localhost:3000`

Copy the client ID and secret into `apps/web/.env.local`:

```env
GOOGLE_CLIENT_ID=xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> Google changes may take 5 minutes to a few hours to propagate.

## 3. Production deployment

Mirror the same four variables into the production environment (`.env.production` on the VPS, or the Coolify secret store). No code changes needed — BetterAuth reads them at runtime.

## 4. Verifying the flow

1. Start the dev server: `pnpm dev`
2. Open <http://localhost:3000/auth/login>
3. Click **Continue with GitHub** or **Continue with Google**
4. You should land back on `/dashboard` with a new user row in the `user` table and a matching `account` row in `account`

## Callback URL reference

BetterAuth auto-derives callback URLs from your base URL:

| Provider | Callback path |
|---|---|
| GitHub | `/api/auth/callback/github` |
| Google | `/api/auth/callback/google` |

## Troubleshooting

- **"redirect_uri_mismatch"** — the callback URL registered with the provider does not exactly match what BetterAuth is sending. Check for `http` vs `https`, trailing slashes, port numbers.
- **Provider button doesn't appear** — check `apps/web/src/config/auth.ts` lists the provider in `providers.oAuth`.
- **"invalid_client"** — client ID or secret is wrong, or the OAuth app is disabled/suspended in the provider console.

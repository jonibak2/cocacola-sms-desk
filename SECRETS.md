# Private SMSPool account through Cloudflare Secrets

The Worker supports `SMSPOOL_API_KEY` as a Cloudflare secret. When this secret exists, every SMSPool API request requires a valid Cloudflare Access JWT: signature, issuer, audience, expiration, not-before time, and the allowed email are checked. A forged email header or CORS Origin cannot authorize a purchase. Client-provided SMSPool keys are overridden by the server secret only after authorization. No secret is returned in configuration or error responses or written to logs.

The same Worker now serves the HTML/CSS/JavaScript at its root. Use this address for private mode:

https://cocacola-sms-proxy.jonibak2006.workers.dev/

GitHub Pages remains available in the existing browser-key mode until you configure Secrets. Adding `SMSPOOL_API_KEY` changes the entire proxy to private mode, including its old endpoints. GitHub Pages will then no longer be the account UI: use the Worker address and sign in through Access. The browser never receives the SMSPool secret in this mode and does not store it in sessionStorage. The existing public GitHub repository can stay public.

## Setup order

1. In Cloudflare, enable **Zero Trust / Access**. This account currently reports that Access is not enabled. Complete any account setup/terms yourself.
2. Protect the Worker's production `workers.dev` URL with Access. In the Worker dashboard, enable Cloudflare Access protection for this production URL. Use an Allow policy for **only your exact email address**. Do not use an Everyone or Bypass policy. Ensure the whole Worker hostname is covered, including `/api/*` and the legacy `/request/*`, `/sms/*`, `/purchase/*` paths. Protect preview URLs too, or disable them.
3. In the Worker's **Settings → Variables and Secrets**, configure these ordinary text variables:
   - `ACCESS_TEAM_DOMAIN`: your Access team origin, such as `https://your-team.cloudflareaccess.com` (no other path).
   - `ACCESS_AUD`: the Application Audience (AUD) tag of the Access application protecting this Worker.
   - `ACCESS_ALLOWED_EMAIL`: the same exact owner email as the Allow policy.
4. Add a variable of type **Secret** named `SMSPOOL_API_KEY`. Enter your SMSPool API key directly in Cloudflare, not into chat, GitHub, source code, shell arguments or a committed `.env` file. Save/deploy the configuration.
5. Open the Worker URL and sign in. The app reads the authenticated session and loads your account automatically. The API key and proxy URL inputs disappear in private mode. Balance refresh, order polling and purchases use the same origin. Disconnect signs out through Access.

Alternatively, the SMSPool key can be entered through the hidden Wrangler prompt:

```powershell
npx wrangler secret put SMSPOOL_API_KEY
```

Do not put the actual key in the command itself. Local secret files `.dev.vars*` and `.env*` are ignored by Git. Ignoring a file does not remove a credential from existing commits or from files copied into `public/`.

## Configuration persists across code deployments

`keep_vars: true` preserves dashboard-configured Access variables on Wrangler deploy. Secrets are managed separately and are not placed into the build. The Worker rejects access if the SMSPool secret exists but Access variables or the JWT are missing/invalid. Existing requests using a browser-supplied key continue only while no server secret exists.

Without a real secret and a completed Access login, anonymous rejection can be tested, but account balance and purchases cannot be verified. Automated tests use fake credentials and a generated test signing key; they never purchase real numbers.

References: [Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [workers.dev Access protection](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

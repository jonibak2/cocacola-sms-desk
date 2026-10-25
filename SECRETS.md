# SMSPool account key in Cloudflare Secrets

Preferred website: https://cocacola-sms-desk.pages.dev/. Its `/api/*` routes call the existing `cocacola-sms-proxy` Worker through the `SMSPOOL_PROXY` Service Binding. The browser does not need to connect to `workers.dev`. Keep `SMSPOOL_API_KEY` only in the original Worker; no key is copied into the Pages deployment. GitHub Pages now uses this Pages API too.

The SMSPool account key stays in a Cloudflare Worker Secret named `SMSPOOL_API_KEY`. It is not sent to the browser, embedded in the site, or committed to GitHub. Anyone who has the site URL can view orders, buy numbers using its balance, and request supported refunds. No email login or access token is required.

## One-time setup

1. Open Cloudflare → **Workers & Pages → cocacola-sms-proxy → Settings → Variables and Secrets**.
2. Add a variable of type **Secret** named `SMSPOOL_API_KEY`.
3. Paste your SMSPool account API key into the value field, then save/deploy. Enter the key directly in Cloudflare, not in chat, source code, or GitHub.
4. Reload [the website](https://jonibak2.github.io/cocacola-sms-desk/). It detects the configured secret and connects automatically, including on another phone or after closing the browser.

The same application also runs at [the Worker URL](https://cocacola-sms-proxy.jonibak2006.workers.dev/). There requests use the same origin. GitHub Pages uses the configured proxy URL and its allowed CORS origin. CORS is browser behavior, not authentication; requests without an Origin header are also accepted.

Alternatively, enter the key in Wrangler's interactive secret prompt:

```powershell
npx wrangler secret put SMSPOOL_API_KEY
```

Do not put the actual key in the command itself. Cloudflare stores the secret separately from source code and preserves it across deployments. `.dev.vars*` and `.env*` are ignored by Git for local development; ignoring a file does not erase previous commits or keep files copied into `public/` private.

## Implementation

- The frontend reads `/api/config`, which only returns whether a server secret exists, and connects without a client key when configured. GitHub Pages can read this configuration through CORS too.
- The Worker overrides any client-supplied key with its own secret before contacting the fixed SMSPool API. Configuration, static assets and upstream errors do not disclose that secret.
- Only existing balance, price, active orders, history, SMS check, cancellation and purchase routes are available. Purchases remain restricted to one Israel CocaCola number per request.
- Cloudflare Access, email policies and additional access tokens are not used. No logging of request bodies or secrets is enabled.
- Until the secret is added, the existing temporary browser-key mode remains available. Deploying code alone does not configure an account key.
- Automated tests use fake credentials and responses; they do not make real purchases.

Reference: [Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

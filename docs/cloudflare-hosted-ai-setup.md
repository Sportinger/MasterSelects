# Cloudflare Hosted AI Setup

## Local development

Hosted auth, billing, and cloud AI do not exist on plain `vite` alone. If you open `http://localhost:5173/` without the Cloudflare backend, routes like `/api/me` and `/api/auth/login` will fail.

Use one of these flows:

```powershell
npm run dev:full
```

This starts:

- Vite on `http://localhost:5173/`
- Cloudflare Pages Functions on `http://127.0.0.1:8788/`

The Vite dev server proxies these hosted routes to the Functions server:

- `/api/me`
- `/api/auth/*`
- `/api/billing/*`
- `/api/stripe/*`
- `/api/ai/chat`
- `/api/ai/video`

If you want to run them separately:

```powershell
npm run dev
npm run dev:api
```

For local auth and billing, create a `.dev.vars` file from `.dev.vars.example`.

`npm run dev:api` now applies local D1 migrations automatically before starting Pages Functions.
If you start `wrangler pages dev` manually, run this first:

```powershell
npm run cf:migrate:local
```

## Secrets

Set these as Cloudflare Pages / Workers secrets:

```powershell
wrangler secret put SESSION_SECRET
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put RESEND_API_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put OPENAI_API_KEY
wrangler secret put KIEAI_API_KEY
```

## Non-secret vars

Configure these as environment variables for the Pages project or in `.dev.vars` for local development:

```env
ENVIRONMENT=development
AUTH_EMAIL_FROM="MasterSelects <auth@example.com>"
GOOGLE_CLIENT_ID=your-google-oauth-client-id
STRIPE_PRICE_STARTER=price_xxx
STRIPE_PRICE_PRO=price_xxx
STRIPE_PRICE_STUDIO=price_xxx
```

Important:

- Local development and preview deployments should use `ENVIRONMENT=development`.
- Production deployments must use `ENVIRONMENT=production`.
- In `wrangler.toml`, keep this split explicit with `[vars]` / `[env.preview.vars]` / `[env.production.vars]`.
- If `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` is missing in production, pricing and billing sync will fail.

## Google OAuth

- Add `https://<your-domain>/api/auth/callback` as an authorized redirect URI in Google Cloud.
- The app requests `openid email profile`.
- Google login is now completed server-side by exchanging the authorization code and fetching the verified user profile.

## Magic Links

- Magic links are delivered through Resend.
- Set `AUTH_EMAIL_FROM` to a verified sender identity in Resend.
- In development, if `RESEND_API_KEY` or `AUTH_EMAIL_FROM` is missing, the login route returns a debug verification URL instead of sending email.

## Stripe

- `checkout` reads `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, and `STRIPE_PRICE_STUDIO`.
- Webhooks must point to `https://<your-domain>/api/stripe/webhook`.
- Billing state is synced into D1 tables via the webhook route.

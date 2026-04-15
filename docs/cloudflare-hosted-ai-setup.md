# Cloudflare Hosted AI Setup

## Local Development

Hosted auth, billing, and hosted AI do not exist on plain `vite` alone. If you open `http://localhost:5173/` without the Cloudflare backend, routes such as `/api/me`, `/api/auth/login`, `/api/billing/summary`, `/api/ai/chat`, and `/api/ai/video` will fail.

Use the combined dev flow:

```powershell
npm run dev:full
```

This starts:

- Vite on `http://localhost:5173/`
- Cloudflare Pages Functions on `http://127.0.0.1:8788/`

If you want to run them separately:

```powershell
npm run dev
npm run dev:api
```

The Vite dev server proxies the hosted routes to the Functions server:

- `/api/me`
- `/api/auth/*`
- `/api/billing/*`
- `/api/stripe/*`
- `/api/ai/chat`
- `/api/ai/video`

`npm run dev:api` applies local D1 migrations automatically. If you run `wrangler pages dev` yourself, run `npm run cf:migrate:local` first.

For local auth and billing, create a `.dev.vars` file from `.dev.vars.example`.

## What The Hosted Stack Does

The browser loads account state from two endpoints in parallel:

- `/api/me`
- `/api/billing/summary`

That summary feeds the visible plan, credit balance, entitlements, hosted AI availability, and Stripe customer/subscription state used by the account and pricing dialogs.

Hosted AI uses two different server routes:

- `/api/ai/chat` is OpenAI-backed and credit-gated
- `/api/ai/video` is Kie.ai-backed for Kling 3.0 and Nano Banana 2, also credit-gated

Hosted chat requests are also logged best-effort into D1:

- successful and failed `/api/ai/chat` calls write rows into `chat_logs`
- stored fields include model, prompt/response payloads, tool calls, token counts, credit cost, duration, and error state
- authenticated users can inspect that history through `/api/ai/chat-history`

Chat streaming is not enabled in phase 1. If the client asks for streaming, the route returns a `501` response.

The hosted video route accepts:

- text-to-video
- image-to-video
- text-to-image for Nano Banana 2

Video status is polled through `/api/ai/video?taskId=...`. Successful hosted requests return a task ID and the current credit balance, which the client syncs back into the account store.

## Secrets

Set these as Cloudflare Pages or Workers secrets:

```powershell
wrangler secret put SESSION_SECRET
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put RESEND_API_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put OPENAI_API_KEY
wrangler secret put KIEAI_API_KEY
```

`OPENAI_API_KEY` is used by hosted chat. `KIEAI_API_KEY` is used by hosted video and hosted image generation.

## Non-Secret Vars

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
- Keep the split explicit in `wrangler.toml` with `[vars]`, `[env.preview.vars]`, and `[env.production.vars]`.
- If `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` is missing in production, pricing and billing sync will fail.

## Auth And Billing

- Add `https://<your-domain>/api/auth/callback` as an authorized redirect URI in Google Cloud.
- The app requests `openid email profile`.
- Google login is completed server-side by exchanging the authorization code and fetching the verified user profile.
- Magic links are delivered through Resend.
- In development, if `RESEND_API_KEY` or `AUTH_EMAIL_FROM` is missing, the login route returns a debug verification URL instead of sending email.
- Billing checkout uses the Stripe portal for existing managed subscriptions and standard checkout for new subscriptions.
- `checkout` reads `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, and `STRIPE_PRICE_STUDIO`.
- Webhooks must point to `https://<your-domain>/api/stripe/webhook`.
- Billing state is synced into D1 tables via the webhook route.

## Hosted Plan Notes

- The current plan set is `free`, `starter`, `pro`, and `studio`.
- The summary endpoint surfaces monthly credits, entitlement flags, and the current Stripe subscription state.
- Free and Starter still include hosted AI chat entitlement in the current plan snapshot.
- Pro adds Kling generation and priority queue entitlement.
- Studio adds API access in addition to the Pro entitlements.
- `dev-login` can seed local sessions with a selected plan for backend-free UI testing.

# AI Credit Pricing Audit

Last checked: 2026-05-27

This document compares MasterSelects credit deductions against the current provider pricing for the AI models exposed or planned for the hosted/FlashBoard panels.

## Sources

- OpenAI official pricing: https://developers.openai.com/api/docs/pricing
- OpenAI latest model guide: https://developers.openai.com/api/docs/guides/latest-model.md
- Kie.ai official API guide: https://docs.kie.ai/index
- Kie.ai pricing page: https://kie.ai/pricing
- Kie.ai public pricing data used by the pricing page:
  - `GET https://api.kie.ai/client/v1/model-pricing/count`
  - `POST https://api.kie.ai/client/v1/model-pricing/page`

Kie.ai documents its pricing page as the complete and current source of truth, and also warns that prices may change when upstream providers change their costs. The Kie.ai count endpoint returned 321 total pricing rows at the time of this audit.

## Current Credit Semantics

MasterSelects has two different credit systems in play. These must not be shown or treated as the same currency:

- MasterSelects hosted credits: monthly app credits granted by the billing plans.
- Kie.ai vendor credits: Kie.ai API credits, where Kie.ai states `1 credit ~= $0.005 USD`.

Current paid plan credit value:

| Plan | Price | Monthly credits | Approx. user price per MasterSelects credit |
|---|---:|---:|---:|
| Free | EUR 0 | 25 | n/a |
| Starter | EUR 4.90 / mo | 4,500 | ~EUR 0.00109 |
| Pro | EUR 14.90 / mo | 13,500 | ~EUR 0.00110 |
| Studio | EUR 29.90 / mo | 27,000 | ~EUR 0.00111 |

Current hosted Kie logic converts provider cost into our own user-facing credit system by charging `6 * vendor Kie credits`. This is not a 1:1 passthrough. Because 1 Kie credit is about `$0.005`, this makes one MasterSelects hosted credit correspond to about `$0.00083` of Kie provider cost before taxes, payment fees, FX, failed jobs, and support overhead.

Margin note: the previous `5x` rule was roughly break-even only after VAT, Stripe fees, and EUR/USD conversion. The current `6x` rule gives the hosted media path a small margin buffer without changing subscription plan prices.

Current purchase surface:

- Subscriptions are implemented: Free, Starter, Pro, Studio.
- One-time credit packs / top-ups are not implemented in the current code.
- `functions/api/billing/checkout.ts` creates Stripe Checkout/Portal flows only for subscription plans.
- `functions/lib/stripe.ts` only resolves Stripe prices for `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, and `STRIPE_PRICE_STUDIO`.
- `.dev.vars.example` only documents those three paid subscription price IDs.
- Credits are granted by `invoice.paid` webhooks via `grantPlanCredits()`, plus a free monthly grant for Free accounts.

Relevant files:

- `functions/lib/modelPricing.ts` - hosted OpenAI fixed credit cost by model.
- `src/components/panels/AIChatPanel.tsx` - UI list for OpenAI models and displayed credits.
- `functions/lib/kieai.ts` - hosted Kie.ai image/video credit calculation.
- `src/services/kieAiService.ts` - BYO Kie.ai providers and BYO Kie price estimates.
- `src/services/flashboard/FlashBoardPricing.ts` - FlashBoard price estimate labels.
- `functions/api/ai/chat.ts` and `functions/api/ai/video.ts` - actual hosted credit gating and deduction.
- `functions/lib/entitlements.ts` - plan credits and entitlement keys.
- `functions/api/billing/checkout.ts` - Stripe checkout entry point.
- `functions/api/stripe/webhook.ts` - subscription invoice credit grants.

BYO Kie account balance display now converts vendor credits to USD with `credits * 0.005`, matching the Kie.ai credit semantics above.

## OpenAI Direct Pricing Check

OpenAI chat billing is token-based. MasterSelects currently charges a fixed number of credits before the request and does not settle against actual provider usage afterward. The client also sends `max_completion_tokens: 4096` or `max_tokens: 4096` for hosted OpenAI chat.

The rough cost column below uses a modest sample request of 1,000 input tokens and 500 output tokens. The "budget" column uses the current Kie-compatible internal rule of thumb that 1 MasterSelects credit should cover about `$0.00083` of provider cost.

| Model | Current MS credits/request | OpenAI input / cached / output per 1M tokens | Rough provider cost at 1k in + 500 out | MS provider budget | Status |
|---|---:|---:|---:|---:|---|
| `gpt-5.2` | 8 | $1.75 / $0.175 / $14.00 | ~$0.00875 | ~$0.00667 | Under at normal response size |
| `gpt-5.2-pro` | 10 | $21.00 / - / $168.00 | ~$0.10500 | ~$0.00833 | Severe undercharge |
| `gpt-5.1` | 5 | $1.25 / $0.125 / $10.00 | ~$0.00625 | ~$0.00417 | Under at normal response size |
| `gpt-5.1-codex` | 5 | Not present in current fetched OpenAI pricing table | Unknown | ~$0.00417 | Verify or remove from hosted UI |
| `gpt-5.1-codex-mini` | 1 | Not present in current fetched OpenAI pricing table | Unknown | ~$0.00083 | Verify or remove from hosted UI |
| `gpt-5` | 5 | $1.25 / $0.125 / $10.00 | ~$0.00625 | ~$0.00417 | Under at normal response size |
| `gpt-5-mini` | 1 | $0.25 / $0.025 / $2.00 | ~$0.00125 | ~$0.00083 | Under |
| `gpt-5-nano` | 1 | $0.05 / $0.005 / $0.40 | ~$0.00025 | ~$0.00083 | OK |
| `o3` | 5 | $2.00 / $0.50 / $8.00 | ~$0.00600 | ~$0.00417 | Under; reasoning tokens add risk |
| `o4-mini` | 3 | $1.10 / $0.275 / $4.40 | ~$0.00330 | ~$0.00250 | Under |
| `o3-pro` | 50 | $20.00 / - / $80.00 | ~$0.06000 | ~$0.04167 | Under; high output risk |
| `gpt-4.1` | 5 | $2.00 / $0.50 / $8.00 | ~$0.00600 | ~$0.00417 | Under |
| `gpt-4.1-mini` | 1 | $0.40 / $0.10 / $1.60 | ~$0.00120 | ~$0.00083 | Under |
| `gpt-4.1-nano` | 1 | $0.10 / $0.025 / $0.40 | ~$0.00030 | ~$0.00083 | OK |
| `gpt-4o` | 5 | $2.50 / $1.25 / $10.00 | ~$0.00750 | ~$0.00417 | Under |
| `gpt-4o-mini` | 1 | $0.15 / $0.075 / $0.60 | ~$0.00045 | ~$0.00083 | OK |

Additional OpenAI mismatch:

- The latest OpenAI model guide currently names `gpt-5.5` as the latest model.
- The current app model list stops at `gpt-5.2` and does not expose `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.5`, or `gpt-5.5-pro`.
- `functions/lib/modelPricing.ts` still contains March 2026 assumptions for `gpt-5.1`, `gpt-5.2`, and `gpt-5.2-pro`; the current OpenAI prices make the pro model especially unsafe at the existing 10-credit charge.

Conclusion: fixed per-request OpenAI billing is not safe for hosted models unless we either enforce much smaller output limits and context budgets per model or move to usage-based post-settlement from `usage.prompt_tokens`, `usage.completion_tokens`, and reasoning/output token metadata.

## Kie.ai Current Pricing Check

### Hosted Kling 3.0

Current Kie.ai rows:

| Kie model row | Vendor credits | Vendor USD | Current BYO estimate | Current hosted MS charge |
|---|---:|---:|---:|---:|
| Kling 3.0, without audio, 720P | 14 / second | $0.070 / second | `std`, no audio = 14 / second | 84 / second |
| Kling 3.0, with audio, 720P | 20 / second | $0.100 / second | `std`, audio = 20 / second | 120 / second |
| Kling 3.0, without audio, 1080P | 18 / second | $0.090 / second | `pro`, no audio = 18 / second | 108 / second |
| Kling 3.0, with audio, 1080P | 27 / second | $0.135 / second | `pro`, audio = 27 / second | 162 / second |
| Kling 3.0, 4K, with or without audio | 67 / second | $0.335 / second | Not exposed by current mode mapping | Not charged explicitly |

MasterSelects conversion examples for 10-second Kling 3.0 generations:

| Variant | Vendor Kie credits | Provider cost | MasterSelects hosted credits | Starter capacity | Pro capacity | Studio capacity |
|---|---:|---:|---:|---:|---:|---:|
| 720P, no audio | 140 | ~$0.70 | 840 | 5 runs | 16 runs | 32 runs |
| 720P, audio | 200 | ~$1.00 | 1,200 | 3 runs | 11 runs | 22 runs |
| 1080P, no audio | 180 | ~$0.90 | 1,080 | 4 runs | 12 runs | 25 runs |
| 1080P, audio | 270 | ~$1.35 | 1,620 | 2 runs | 8 runs | 16 runs |
| 4K | 670 | ~$3.35 | 4,020 | 1 run | 3 runs | 6 runs |

This explains the apparent `700` vs `180` mismatch from earlier checks: `180` is the current 10-second 1080P no-audio vendor charge, while hosted MasterSelects credits are no longer a vendor-credit passthrough. In MasterSelects hosted credits, 10-second 1080P no-audio should now be `1,080` credits under the current conversion rule.

Current code matches the exposed 720P/1080P Kie rates:

- `src/services/kieAiService.ts` uses 14/20/18/27 vendor credits per second.
- `functions/lib/kieai.ts` applies the same rates and multiplies by 5 for hosted credits.
- Multi-shot currently forces audio billing, which matches the local Kie skill note.

Conclusion: hosted Kling 3.0 charges enough for the currently exposed 720P/1080P paths under the 6x vendor-credit rule. 4K must not be exposed until pricing is added.

Entitlement mismatch: `functions/lib/entitlements.ts` says only Pro and Studio include `kling_generation`, but `functions/api/ai/video.ts` currently checks login and credit balance, not `billing.klingGenerationEnabled`. If the product intent is "Starter can buy/use images but not Kling video", the server route needs an entitlement gate.

### Hosted Nano Banana 2

Current Kie.ai rows:

| Kie model row | Vendor credits | Vendor USD | Current hosted MS charge |
|---|---:|---:|---:|
| Google nano banana 2, 1K | 8 / image | $0.040 | 48 |
| Google nano banana 2, 2K | 12 / image | $0.060 | 72 |
| Google nano banana 2, 4K | 18 / image | $0.090 | 108 |

Current code matches these Kie rates:

- `functions/lib/kieai.ts` has `0.04`, `0.06`, `0.09` USD for 1K/2K/4K.
- `src/services/flashboard/FlashBoardPricing.ts` duplicates the same values.
- Both calculate Kie vendor credits by dividing by `$0.005` and multiplying by 6 for hosted credits.

Conclusion: hosted Nano Banana 2 charges enough under the current 6x vendor-credit rule.

### Seedance 2.0 Gap

The FlashBoard catalog exposes `bytedance/seedance-2` for BYO Kie.ai, but `src/services/kieAiService.ts` does not define rates for it. `calculateKieAiCost()` falls back to `duration * 14`, which severely under-displays cost for Seedance.

Current Kie.ai Seedance 2 rows:

| Kie model row | Vendor credits | Vendor USD |
|---|---:|---:|
| bytedance/seedance-2, 480p no video input | 19 / second | $0.095 / second |
| bytedance/seedance-2, 480p with video input | 11.5 / second | $0.057 / second |
| bytedance/seedance-2, 720p no video input | 41 / second | $0.205 / second |
| bytedance/seedance-2, 720p with video input | 25 / second | $0.125 / second |
| bytedance/seedance-2, 1080p no video input | 102 / second | $0.510 / second |
| bytedance/seedance-2, 1080p with video input | 62 / second | $0.310 / second |
| bytedance/seedance-2 fast, 480p no video input | 15.5 / second | $0.0775 / second |
| bytedance/seedance-2 fast, 480p with video input | 9 / second | $0.045 / second |
| bytedance/seedance-2 fast, 720p no video input | 33 / second | $0.165 / second |
| bytedance/seedance-2 fast, 720p with video input | 20 / second | $0.100 / second |

Conclusion: Seedance needs explicit BYO estimate logic before the price list panel can be trusted. Hosted Seedance is not currently implemented in `functions/api/ai/video.ts`.

### Kie.ai Image Candidates

These are not fully wired into hosted MasterSelects billing today, but are relevant for a user-facing model price panel if we add them to the catalog.

| Kie model row | Vendor credits | Vendor USD | Suggested hosted MS credits |
|---|---:|---:|---:|
| Google nano banana pro, 1/2K | 18 / image | $0.09 | 108 |
| Google nano banana pro, 4K | 24 / image | $0.12 | 144 |
| google imagen4, Fast | 4 / request | $0.02 | 24 |
| google imagen4, default | 8 / request | $0.04 | 48 |
| google imagen4, Ultra | 12 / image | $0.06 | 72 |
| seedream 5.0 Lite, text/image-to-image | 5.5 / image | $0.0275 | 33 |
| seedream 4.5, text/image-to-image | 6.5 / image | $0.0325 | 39 |
| Qwen z-image, text-to-image | 0.8 / image | $0.004 | 5 if rounded up |
| Qwen Image, text/image-to-image | 4 / megapixel | $0.02 / megapixel | 24 / megapixel |
| Qwen image-edit | 5 / megapixel | $0.03 / megapixel | 30 / megapixel |
| Qwen2 Image edit/text-to-image | 5.6 / image | $0.028 | 34 if rounded up |
| Ideogram V3 Turbo/Balanced/Quality | 3.5 / 7 / 10 per image | $0.0175 / $0.035 / $0.05 | 21 / 42 / 60 |
| Ideogram Character Turbo/Balanced/Quality | 12 / 18 / 24 per image | $0.06 / $0.09 / $0.12 | 72 / 108 / 144 |

Rounding rule recommendation: when multiplying fractional Kie credits by 6, use `Math.ceil(vendorCredits * 6)` so hosted usage never undercharges fractional rows.

## Findings

1. Hosted Kie.ai Kling 3.0 and Nano Banana 2 currently match Kie.ai public pricing and charge enough under the 6x vendor-credit rule.
2. BYO Seedance 2.0 price estimates are wrong because they fall through to the generic `duration * 14` fallback.
3. BYO Kie account balance USD display has been corrected to use `credits * 0.005`.
4. There are no one-time credit packs/top-ups implemented yet; users currently buy credits only through subscription plans.
5. The server video route does not currently enforce the `kling_generation` entitlement even though the plan model defines it.
6. Hosted OpenAI chat is financially unsafe for premium and high-output requests because the app charges fixed credits while OpenAI bills by tokens.
7. `gpt-5.2-pro` is the most serious OpenAI mismatch: current code charges 10 credits, but even a small 1k input / 500 output request costs about `$0.105` at current OpenAI pricing.
8. The OpenAI model list is stale relative to the latest OpenAI docs: `gpt-5.5` is latest, while the app still centers `gpt-5.2`.
9. Pricing data is duplicated across backend, frontend, comments, and UI arrays. That makes the future user-facing price panel likely to drift unless we create one shared pricing catalog.

## Recommended Implementation Plan

1. Create a shared AI pricing catalog that includes provider, model id, display name, unit, user-visible credits, provider cost basis, source URL, and `lastCheckedAt`.
2. Replace `OPENAI_MODELS` in `AIChatPanel.tsx` and `MODEL_PRICING` in `functions/lib/modelPricing.ts` with data derived from the shared catalog or mirrored generated files.
3. For OpenAI hosted chat, switch from fixed request billing to estimate-plus-settlement:
   - Pre-authorize credits from model, estimated input tokens, and requested max output.
   - Call OpenAI with explicit max output limits per tier.
   - Finalize credit deduction from provider `usage` fields.
   - Keep idempotency protection via the existing ledger source/idempotency key design.
4. Add explicit Seedance 2.0 price estimate logic for BYO, including no-video-input vs video-input and fast vs standard variants.
5. Keep BYO Kie account USD display covered by regression tests so it stays at `credits * 0.005`.
6. Decide and implement the product rule for Starter:
   - If Starter should only get chat/image access, enforce `kling_generation` in `/api/ai/video`.
   - If Starter should be allowed to spend credits on Kling, update plan entitlements and user-facing copy so the server and UI agree.
7. Decide whether one-time credit packs exist. If yes, add a separate Stripe payment-mode checkout path, price IDs, ledger source, webhook grant, and UI surface.
8. Build the price list panel from the same catalog used for billing. The panel should show:
   - Model name and provider.
   - MasterSelects credits charged.
   - Billing unit, for example request, image, second, megapixel, or token.
   - Short explanation of what changes the cost, for example duration, audio, resolution, or token usage.
   - Last checked date and source link.
9. Add tests for:
   - OpenAI UI model list and backend pricing parity.
   - Hosted Kie Kling/Nano Banana pricing parity.
   - Hosted video entitlement enforcement.
   - Subscription credit grants and any future top-up grants.
   - Seedance price estimates.
   - No unknown hosted model can silently fall back to a cheap default.

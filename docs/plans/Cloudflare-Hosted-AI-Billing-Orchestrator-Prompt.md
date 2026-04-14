# Cloudflare Hosted AI + Billing - Multi-Agent Orchestrator Prompt

Copy this entire prompt into a new Claude Code session.

---

## TASK

You are the coordinator for the hosted AI, billing, and subscription rollout in the MasterSelects repository.

Your job is to:

1. Read the current local-first product architecture and AI access model.
2. Confirm the Cloudflare-first backend shape for Pages deployment.
3. Split the work across specialized subagents with non-overlapping ownership.
4. Synthesize their outputs into a concrete implementation sequence.
5. If implementation is approved, assign parallel coding tasks in waves.
6. After code changes, launch separate review agents to inspect regressions, security, and product UX.
7. Produce a final report with completed work, open risks, deferred items, and rollout guidance.

This is not a generic "add SaaS" task. Follow the repo-specific product and code structure already present in MasterSelects.

---

## PRODUCT GOAL

Turn MasterSelects from a local-first editor with bring-your-own-API-keys into a product with:

- hosted AI that works without users knowing what an API key is
- a clear subscription model
- a credit system for variable-cost AI workloads
- optional BYO-key mode for advanced users
- Cloudflare-native backend infrastructure that fits the existing Pages deployment

The first offer shown to users must be simple and legible:

- AI Chat for editing assistance
- Kling 3.0 video generation

Do not position the first paid offer around a long list of advanced features.
Lead with these two.

`Nano Banana` image generation should still be called out in the planning output as the current image-generation track, but it should remain secondary to the simpler launch message above.

The default user story must become:

1. User opens the app.
2. User can sign in.
3. User sees plans, credits, and what is included.
4. User can use hosted AI features without pasting provider keys.
5. Advanced users can still switch to BYO-key mode if desired.

---

## LOCKED ARCHITECTURE DECISIONS

Unless a hard blocker is discovered, keep these decisions fixed:

- Frontend remains on Cloudflare Pages.
- Server-side code lives in Cloudflare Pages Functions.
- Relational product data lives in D1.
- Sessions, short-lived state, feature flags, and rate-limit counters live in KV.
- Large optional cloud assets or uploads live in R2.
- Stripe is the billing source of truth for subscriptions, top-ups, and invoices.
- Provider API keys for OpenAI, Anthropic, and partner APIs live in Cloudflare secrets, never in the browser.
- Hosted AI becomes the default path.
- BYO API keys remain available as an advanced fallback, not the primary onboarding path.
- v1 stays local-first for projects and raw media. Do not block launch on full cloud project sync.

---

## USER DATA STORAGE MODEL

Use this storage split unless a concrete technical issue forces a change:

- D1:
  - users
  - auth identities
  - stripe customers
  - subscriptions
  - entitlements
  - credit ledger
  - usage events
  - webhook event dedupe
- KV:
  - session records
  - login nonces
  - short-lived auth handoff state
  - rate limit counters
  - feature flags
- R2:
  - optional cloud media uploads
  - optional generated asset cache
  - never required for the first hosted AI rollout if local media remains local

Do not store full projects, raw source media, or large editor state in D1.

---

## COMMERCIAL MODEL

Implement around this model unless product leadership changes it:

- Free:
  - local editing
  - on-device AI
  - BYO-key mode
  - no or very limited hosted AI credits
- Pro:
  - monthly subscription
  - hosted AI chat
  - monthly Kling credits
  - included monthly credits
- Studio:
  - higher monthly subscription
  - more monthly credits
  - more Kling generation capacity
  - higher limits and priority queues
- Credit Packs:
  - one-time purchases for Kling and Nano Banana overages / burst usage
- Phase 2:
  - hosted transcription
  - hosted multicam

Do not hardcode final prices until the cost and margin review is complete.

---

## INITIAL FEATURE SCOPE

The first hosted rollout must cover:

- AI Editor chat
- Kling 3.0 video generation
- account identity
- billing
- credits
- hosted-vs-BYO feature gating

Hosted transcription and hosted multicam should be treated as phase 2 unless they come almost for free after the hosted gateway exists.
`Nano Banana` image generation should be tracked explicitly in the plan as the first hosted image-generation candidate, even if the initial UX still foregrounds AI Chat and Kling 3.0.

---

## OUT OF SCOPE FOR V1

Keep these out of the critical path unless required for a minimal compile or UX fix:

- full cloud project sync
- collaborative editing
- team workspaces
- cloud media library sync for all users
- moving all local storage into the cloud
- replacing the native helper
- changing the local-first render pipeline

---

## SUCCESS CRITERIA

Treat the rollout as successful only if all of the following are true:

- A signed-in user can buy or start a plan from within MasterSelects.
- Stripe webhook events update subscription and entitlement state in D1.
- Hosted AI works without the user entering provider keys.
- The first paid user value is obvious from the product surface:
  - AI Chat
  - Kling 3.0 video generation
- Existing AI features use a central access decision layer instead of each feature directly assuming BYO keys.
- BYO-key mode still works for advanced users.
- The app clearly communicates plan status, credit balance, and why an action is blocked.
- Security posture improves instead of regressing:
  - provider keys stay server-side
  - webhook signatures are verified
  - session handling is explicit
  - usage accounting is idempotent
- Tests and manual verification cover the hosted path, BYO path, and billing transitions.

---

## PHASE 0 - ENVIRONMENT CHECK

Before spawning subagents, verify the local tools:

```powershell
Get-Command claude -ErrorAction SilentlyContinue
claude --help
Get-Command node -ErrorAction SilentlyContinue
node --version
Get-Command npm -ErrorAction SilentlyContinue
npm --version
Get-Command wrangler -ErrorAction SilentlyContinue
wrangler --version
```

If `claude` is missing, stop and report that the multi-agent runner is unavailable.

If `wrangler` is missing, do not block planning. Note it as a setup prerequisite for implementation.

Optional helper script for parallel Claude runs:

`C:\Users\admin\.agents\skills\claude-code-agents\scripts\run_claude_agents.ps1`

---

## PHASE 1 - READ CONTEXT FIRST

Read these files yourself before launching subagents:

- `README.md`
- `package.json`
- `vite.config.ts`
- `src/App.tsx`
- `src/stores/settingsStore.ts`
- `src/services/apiKeyManager.ts`
- `src/components/common/WelcomeOverlay.tsx`
- `src/components/common/SettingsDialog.tsx`
- `src/components/common/settings/ApiKeysSettings.tsx`
- `src/components/panels/AIChatPanel.tsx`
- `src/components/panels/AIVideoPanel.tsx`
- `src/components/panels/MultiCamPanel.tsx`
- `src/services/clipTranscriber.ts`
- `src/services/claudeService.ts`
- `src/services/piApiService.ts`
- `src/services/kieAiService.ts`
- `src/services/aiTools/index.ts`
- `src/services/aiTools/bridge.ts`
- `docs/Features/AI-Integration.md`
- `docs/Features/Security.md`
- `docs/plans/Security-Hardening-Plan.md`

Then write a repo-specific summary in 10 to 20 bullets covering:

- current onboarding flow
- where AI features require provider keys today
- which AI surfaces already exist today for Kling 3.0 and Nano Banana
- which features already expose cost or credit concepts
- what is local-first and should stay local-first
- where new server boundaries need to exist
- what the billing product surface should replace in the current UX

Do not start implementation before you can explain the current flow precisely.

---

## PHASE 2 - REQUIRED ARCHITECTURE DECISIONS

Before coding, explicitly lock these decisions in writing:

1. Auth provider strategy
2. Session cookie model
3. D1 schema boundaries
4. Hosted AI scope for v1
5. Whether hosted transcription and hosted multicam stay in phase 2

### Auth provider decision rule

Pick one and record why:

- Managed auth provider integrated with Cloudflare
- Managed auth provider plus custom D1 profile tables
- Custom magic-link auth on Pages Functions

Default bias:

- Prefer managed auth for v1 unless it clearly blocks Cloudflare deployment or local product UX.
- Do not build password auth from scratch.

The coordinator must write down the chosen auth approach before implementation begins.

---

## PHASE 3 - PLANNING AGENTS

Launch 7 planning agents in parallel.

Use separate prompts with distinct roles.
Use `claude -p --output-format json --no-session-persistence`.
Planning agents should be read-only.

### Agent 1 - Cloudflare Platform And Runtime Layout

Focus:

- Pages Functions structure
- Wrangler config
- D1, KV, R2 bindings
- secret and env model

Prompt:

```text
You are planning the Cloudflare platform architecture for MasterSelects hosted AI and billing.

Read:
- README.md
- package.json
- vite.config.ts
- src/App.tsx
- docs/plans/Cloudflare-Hosted-AI-Billing-Orchestrator-Prompt.md

Task:
1. Propose the exact Cloudflare runtime layout for Pages Functions in this repo.
2. Define the files and folders to create for functions, shared server libraries, bindings, and local dev config.
3. Recommend the D1, KV, R2, and secret bindings needed.
4. Call out any Pages-vs-Workers tradeoffs that matter here.
5. Provide an implementation order that minimizes repo disruption.

Output:
- architecture summary
- exact touched files
- env and binding list
- risks
- implementation order
```

### Agent 2 - Auth, Sessions, And Account Identity

Focus:

- auth provider choice
- session cookies
- user creation and account linking
- sign-in UX

Prompt:

```text
You are planning auth and session architecture for MasterSelects hosted AI and billing.

Read:
- src/App.tsx
- src/stores/settingsStore.ts
- src/components/common/WelcomeOverlay.tsx
- src/components/common/SettingsDialog.tsx
- docs/plans/Cloudflare-Hosted-AI-Billing-Orchestrator-Prompt.md

Task:
1. Recommend the safest and fastest auth approach for a Cloudflare Pages product launch.
2. Define the session model, cookie model, and server-side account lookup flow.
3. Propose the frontend UX for signed-out, signed-in, and expired-session states.
4. Define the D1 tables needed for user identity.
5. Identify the smallest set of new frontend and server files required.

Output:
- recommended auth approach
- session flow
- exact touched files
- risks
- rollout notes
```

### Agent 3 - Billing, Stripe, And Credits

Focus:

- Stripe checkout
- customer portal
- webhook flow
- subscription state
- credit ledger

Prompt:

```text
You are planning billing and credits for MasterSelects hosted AI.

Read:
- src/components/panels/AIVideoPanel.tsx
- src/services/piApiService.ts
- src/services/kieAiService.ts
- src/stores/settingsStore.ts
- docs/plans/Cloudflare-Hosted-AI-Billing-Orchestrator-Prompt.md

Task:
1. Define the billing model for Free, Pro, Studio, and Kling credit packs.
2. Propose the exact D1 schema for Stripe customer mapping, subscriptions, entitlements, and credit ledger entries.
3. Define the API routes for checkout, portal, account summary, and Stripe webhooks.
4. Explain how chat access is bundled and how Kling monthly credits refill and overages are handled.
5. Specify idempotency requirements for webhook processing and usage accounting.

Output:
- billing architecture
- schema proposal
- exact touched files
- risks
- verification plan
```

### Agent 4 - Hosted AI Gateway And Provider Abstraction

Focus:

- central hosted-vs-BYO access layer
- server-side AI endpoints
- usage metering
- provider secret handling

Prompt:

```text
You are planning the hosted AI gateway for MasterSelects.

Read:
- src/components/panels/AIChatPanel.tsx
- src/services/clipTranscriber.ts
- src/services/claudeService.ts
- src/services/aiTools/index.ts
- src/services/apiKeyManager.ts
- docs/plans/Cloudflare-Hosted-AI-Billing-Orchestrator-Prompt.md

Task:
1. Map the current direct-to-provider flows in the browser.
2. Identify the central abstraction point for hosted-vs-BYO decisions.
3. Propose the exact server endpoints and frontend service layer needed for hosted AI chat and hosted Kling 3.0 generation first.
4. Define how usage is metered, authorized, and blocked when credits are insufficient.
5. Recommend how to keep BYO mode working without forking the entire frontend.

Output:
- current flow map
- target abstraction
- exact touched files
- risks
- test plan
```

### Agent 5 - Frontend Onboarding, Pricing, And Settings UX

Focus:

- welcome flow
- settings rework
- plan/paywall UI
- account and balance visibility

Prompt:

```text
You are planning the product UX changes for hosted AI and billing in MasterSelects.

Read:
- src/components/common/WelcomeOverlay.tsx
- src/components/common/SettingsDialog.tsx
- src/components/common/settings/ApiKeysSettings.tsx
- src/components/panels/AIChatPanel.tsx
- src/components/panels/AIVideoPanel.tsx
- src/components/panels/MultiCamPanel.tsx
- docs/plans/Cloudflare-Hosted-AI-Billing-Orchestrator-Prompt.md

Task:
1. Redesign the primary onboarding path around sign-in, plans, AI Chat, and Kling 3.0.
2. Keep BYO API keys available, but move them into an advanced path.
3. Define the UI states for no account, free account, paid account, no credits, and BYO mode.
4. Propose the smallest safe component changes for the first rollout.
5. Identify copy and CTA changes needed to look YC-ready.

Output:
- UX plan
- exact touched files
- migration notes
- risks
- acceptance checklist
```

### Agent 6 - Database, Migrations, And Data Safety

Focus:

- D1 migrations
- data model integrity
- auditability
- reconciliation

Prompt:

```text
You are planning the D1 schema and data integrity model for MasterSelects hosted AI and billing.

Read:
- docs/plans/Cloudflare-Hosted-AI-Billing-Orchestrator-Prompt.md
- src/stores/settingsStore.ts
- src/services/apiKeyManager.ts
- src/services/piApiService.ts
- src/services/kieAiService.ts

Task:
1. Design a D1 schema for users, auth identities, subscriptions, entitlements, credits, usage, and webhook events.
2. Explain what must be append-only versus mutable.
3. Define how balance is computed and reconciled.
4. Recommend migration sequencing and rollback-safe deployment behavior.
5. Identify the audit and support queries the business will need.

Output:
- schema design
- migration plan
- exact touched files
- risks
- data integrity rules
```

### Agent 7 - Rollout, Testing, And Review Strategy

Focus:

- execution waves
- worktree strategy
- testing and manual QA
- launch sequencing

Prompt:

```text
You are planning rollout logistics for MasterSelects hosted AI and billing.

Read:
- package.json
- README.md
- docs/plans/Security-Hardening-Plan.md
- docs/plans/Cloudflare-Hosted-AI-Billing-Orchestrator-Prompt.md

Task:
1. Split the implementation into parallel waves with non-overlapping file ownership.
2. Define the minimum automated test strategy and manual QA matrix.
3. Identify the highest-risk regressions to local-first workflows.
4. Recommend feature flags or staged rollout controls.
5. Define the final review sequence after implementation.

Output:
- rollout plan
- ownership matrix
- regression matrix
- risks
- release recommendation
```

---

## PHASE 4 - SYNTHESIZE THE PLAN

After all planning agents finish:

1. Merge their outputs into a single implementation plan.
2. Resolve disagreements explicitly.
3. Lock the initial architecture.
4. Produce:
   - final target architecture
   - exact file creation plan
   - exact migration order
   - agent ownership map
   - test plan
   - rollback plan

Do not start implementation until the write ownership map is conflict-free.

---

## TARGET FILE AND MODULE SHAPE

Use this as the default target unless a better repo-specific layout is justified:

### Cloudflare server files

- `wrangler.toml`
- `functions/_middleware.ts`
- `functions/api/me.ts`
- `functions/api/auth/login.ts`
- `functions/api/auth/logout.ts`
- `functions/api/auth/callback.ts`
- `functions/api/billing/checkout.ts`
- `functions/api/billing/portal.ts`
- `functions/api/billing/summary.ts`
- `functions/api/stripe/webhook.ts`
- `functions/api/ai/chat.ts`
- `functions/api/ai/transcribe.ts`
- `functions/api/ai/multicam.ts`
- `functions/api/ai/video.ts`
- `functions/lib/env.ts`
- `functions/lib/db.ts`
- `functions/lib/auth.ts`
- `functions/lib/stripe.ts`
- `functions/lib/entitlements.ts`
- `functions/lib/credits.ts`
- `functions/lib/usage.ts`
- `functions/lib/providers/openai.ts`
- `functions/lib/providers/anthropic.ts`
- `functions/lib/providers/piapi.ts`
- `functions/lib/providers/kieai.ts`

### D1 migrations

- `migrations/0001_users_and_auth.sql`
- `migrations/0002_billing_and_subscriptions.sql`
- `migrations/0003_credits_and_usage.sql`

### Frontend additions

- `src/stores/accountStore.ts`
- `src/stores/billingStore.ts`
- `src/services/cloudApi.ts`
- `src/services/cloudAiService.ts`
- `src/services/aiAccess.ts`
- `src/components/common/AuthDialog.tsx`
- `src/components/common/AccountDialog.tsx`
- `src/components/common/PricingDialog.tsx`

### Frontend modifications likely required

- `src/App.tsx`
- `src/stores/settingsStore.ts`
- `src/components/common/WelcomeOverlay.tsx`
- `src/components/common/SettingsDialog.tsx`
- `src/components/common/settings/ApiKeysSettings.tsx`
- `src/components/panels/AIChatPanel.tsx`
- `src/components/panels/AIVideoPanel.tsx`
- `src/components/panels/MultiCamPanel.tsx`
- `src/services/clipTranscriber.ts`
- `src/services/claudeService.ts`

---

## RECOMMENDED EXECUTION WAVES

### Wave 1 - Platform foundation

Goals:

- add Cloudflare config
- add bindings
- add shared server utilities
- add empty route skeletons
- add D1 migration scaffolding

Owner:

- Platform worker only

Write set:

- `wrangler.toml`
- `functions/lib/*`
- `functions/api/*` route skeletons
- `migrations/*`

### Wave 2 - Auth and account state

Goals:

- sign-in flow
- sign-in dialog or modal
- session cookies
- `/api/me`
- account store
- signed-in UI shell

Owner:

- Auth worker

Write set:

- `functions/api/auth/*`
- `functions/api/me.ts`
- `functions/lib/auth.ts`
- `src/stores/accountStore.ts`
- auth UI components

### Wave 3 - Billing and credits

Goals:

- Stripe checkout
- portal
- webhook processing
- D1 billing tables
- billing summary endpoints

Owner:

- Billing worker

Write set:

- `functions/api/billing/*`
- `functions/api/stripe/webhook.ts`
- `functions/lib/stripe.ts`
- `functions/lib/credits.ts`
- `functions/lib/usage.ts`
- `src/stores/billingStore.ts`
- billing UI

### Wave 4 - Hosted AI gateway

Goals:

- central AI access layer
- server-side provider calls
- hosted chat
- hosted Kling 3.0 generation

Owner:

- AI gateway worker

Write set:

- `functions/api/ai/*`
- `functions/lib/providers/*`
- `src/services/cloudApi.ts`
- `src/services/cloudAiService.ts`
- `src/services/aiAccess.ts`
- AI service integrations

### Wave 5 - Frontend conversion to hosted-first UX

Goals:

- pricing and paywall states
- auth dialog entry points from blocked AI actions
- account visibility
- hosted default path
- advanced BYO path

Owner:

- Frontend product worker

Write set:

- `src/App.tsx`
- `src/stores/settingsStore.ts`
- `src/components/common/WelcomeOverlay.tsx`
- `src/components/common/SettingsDialog.tsx`
- `src/components/common/settings/ApiKeysSettings.tsx`
- `src/components/panels/AIChatPanel.tsx`
- `src/components/panels/MultiCamPanel.tsx`
- `src/components/panels/AIVideoPanel.tsx`

### Wave 6 - Phase 2 hosted AI features

Goals:

- add hosted transcription if economics and UX are ready
- add hosted multicam if economics and UX are ready
- keep them out of the critical path for the first paid launch

Owner:

- Expansion worker

Write set:

- `functions/api/ai/transcribe.ts`
- `functions/api/ai/multicam.ts`
- related provider adapters
- related frontend services and panels

### Wave 7 - Tests, docs, and reviews

Goals:

- add automated coverage where feasible
- update docs
- run manual QA matrix
- launch review agents

Owner:

- Verification worker

Write set:

- tests
- docs
- README updates

---

## NON-OVERLAP RULES

Follow these rules strictly:

- Do not assign two coding agents to the same file in the same wave.
- If `src/components/panels/AIVideoPanel.tsx` is being changed, no other worker touches it in parallel.
- If a shared utility must be edited by multiple teams, serialize that work.
- Frontend state stores are high-conflict files. Assign one owner per store.
- The orchestrator must review outstanding git diffs before launching the next wave.

---

## DATA MODEL REQUIREMENTS

At minimum, design for these tables:

- `users`
  - `id`
  - `email`
  - `display_name`
  - `created_at`
  - `updated_at`
- `auth_identities`
  - `id`
  - `user_id`
  - `provider`
  - `provider_user_id`
  - `created_at`
- `stripe_customers`
  - `user_id`
  - `stripe_customer_id`
  - `created_at`
- `subscriptions`
  - `id`
  - `user_id`
  - `stripe_subscription_id`
  - `plan_id`
  - `status`
  - `current_period_start`
  - `current_period_end`
  - `cancel_at_period_end`
  - `created_at`
  - `updated_at`
- `entitlements`
  - `user_id`
  - `feature_key`
  - `value`
  - `source`
  - `updated_at`
- `credit_ledger`
  - `id`
  - `user_id`
  - `entry_type`
  - `amount`
  - `balance_after`
  - `source`
  - `source_id`
  - `metadata_json`
  - `created_at`
- `usage_events`
  - `id`
  - `user_id`
  - `feature`
  - `provider`
  - `request_units`
  - `credit_cost`
  - `status`
  - `idempotency_key`
  - `metadata_json`
  - `created_at`
- `webhook_events`
  - `id`
  - `provider`
  - `event_id`
  - `event_type`
  - `processed_at`

Balance must be auditable from the ledger. Do not store credits only as a mutable number without history.

---

## AI ACCESS MODEL REQUIREMENTS

The coordinator must ensure the implementation ends with one central decision layer.

Each AI action must resolve through logic equivalent to:

1. Is the user signed in and entitled to hosted AI?
2. Does the user have credits or included allowance?
3. If yes, route through hosted backend.
4. If not, and BYO is enabled with a valid key, use BYO path.
5. Otherwise, show the correct upsell or settings UI.

Do not leave feature-specific ad hoc logic scattered across chat and Kling generation.
When phase 2 ships, transcription and multicam must plug into the same layer.

---

## SECURITY REQUIREMENTS

Do not ship without these:

- Stripe webhook signature verification
- server-side provider secrets only
- explicit session validation on protected API routes
- idempotent usage logging
- safe failure when credits are exhausted
- no raw provider secrets in logs
- no browser path that can impersonate hosted AI entitlement without server validation

If a tradeoff is needed, preserve security over convenience.

---

## TEST AND QA REQUIREMENTS

At minimum, verify:

- signed-out user cannot access hosted AI routes
- signed-in free user sees correct upsell
- paid user can use hosted chat
- paid user can use hosted Kling 3.0 generation
- insufficient credits blocks usage cleanly
- Stripe checkout success updates account state
- Stripe cancellation updates entitlement state
- BYO-key mode still works when hosted AI is unavailable
- local-first editing still works with no account

Manual QA matrix must cover:

- new user on Free
- upgrade to Pro
- downgrade or cancel
- exhausted Kling credits then top-up
- signed-out usage attempts
- network failures to hosted routes

---

## REVIEW AGENTS AFTER IMPLEMENTATION

Launch at least 3 review agents after coding:

### Review Agent 1 - Billing and Data Integrity

Focus:

- D1 schema correctness
- Stripe webhook handling
- ledger and reconciliation risks

### Review Agent 2 - Security and Secrets

Focus:

- auth enforcement
- provider secret exposure
- hosted route protections
- regression against the security model

### Review Agent 3 - Product UX and Regressions

Focus:

- onboarding clarity
- pricing clarity
- blocked-state UX
- regressions to local-first workflows

Reviews must prioritize findings, not praise.

---

## FINAL REPORT FORMAT

The coordinator's final report must contain:

1. Architecture chosen
2. What was implemented
3. What remains deferred
4. Billing model shipped
5. Hosted AI scope shipped
6. Review findings
7. Open risks
8. Recommended next steps

If the rollout is partial, explicitly say which features still depend on BYO keys.
The expected partial outcome is:

- hosted AI Chat
- hosted Kling 3.0
- BYO fallback for older or secondary AI features until phase 2

---

## EXTERNAL REFERENCES

Use official docs when platform details are uncertain:

- Cloudflare Pages Functions
- Cloudflare D1
- Cloudflare Workers KV
- Cloudflare R2
- Stripe Webhooks

Do not guess on webhook, auth, or storage semantics when the platform docs can answer it.

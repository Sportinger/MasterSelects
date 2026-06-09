# Agent 06 - AI / Security / Cloud / Billing Audit

## Scope

AI tools/chat/agent bridge, AI generation, hosted/cloud auth, billing/credits, security/privacy, Cloudflare functions, legal/account/pricing docs, and the issue-credit campaign. This audit only read README and docs; no README or docs/features files were edited.

## Sources inspected

- `README.md`
- `docs/features/AI-Integration.md`
- `docs/features/Security.md`
- `docs/features/Multicam-AI.md`
- `docs/features/FlashBoard.md`
- `docs/features/Issue-Credit-Campaign.md`
- `docs/completed/misc/cloudflare-hosted-ai-setup.md`
- `index.html`
- `src/services/aiTools/**`
- `src/components/panels/AIChatPanel.tsx`
- `src/components/panels/flashboard/FlashBoardComposer.tsx`
- `src/services/flashboard/**`
- `src/services/cloudAiService.ts`, `src/services/cloudApi.ts`, `src/services/cloudAiPricing.ts`, `src/services/billingPlans.ts`
- `src/stores/accountStore.ts`, `src/stores/settingsStore.ts`, `src/stores/flashboardStore/**`
- `functions/**`, `wrangler.toml`, `.dev.vars.example`
- `src/components/common/LegalDialog.tsx`, `src/components/common/PricingDialog.tsx`
- `tests/security/**`, `tests/unit/aiToolPolicy.test.ts`, `tests/unit/redact.test.ts`, `tests/unit/logRedaction.test.ts`

## Confirmed accurate claims

- Hosted auth/billing/AI require the Cloudflare Functions backend, not plain Vite. The setup doc states this for `/api/me`, `/api/auth/login`, `/api/billing/summary`, `/api/ai/chat`, `/api/ai/audio`, and `/api/ai/video` (`docs/completed/misc/cloudflare-hosted-ai-setup.md:5`), and those routes exist under `functions/api/**`.
- Hosted chat is auth, entitlement, and credit gated. `/api/ai/chat` rejects unauthenticated users (`functions/api/ai/chat.ts:174-197`), rejects missing hosted AI entitlement (`functions/api/ai/chat.ts:197`), checks credit balance (`functions/api/ai/chat.ts:227`), spends credits (`functions/api/ai/chat.ts:281`), and logs both completed and failed attempts (`functions/api/ai/chat.ts:334`, `functions/api/ai/chat.ts:370`).
- Hosted chat streaming is correctly documented as unsupported. The route returns a `stream_not_supported` 501 response when `stream === true` (`functions/api/ai/chat.ts:113`, `functions/api/ai/chat.ts:171`; docs at `docs/completed/misc/cloudflare-hosted-ai-setup.md:60`).
- Hosted FlashBoard audio/video/image generation is backed by Cloudflare routes and credits. Video/image generation computes credits per provider (`functions/api/ai/video.ts:124`, `functions/api/ai/video.ts:147`, `functions/api/ai/video.ts:183`) and spends credits (`functions/api/ai/video.ts:444`). Hosted audio requires access (`functions/api/ai/audio.ts:138`), charges Suno upfront (`functions/api/ai/audio.ts:171`, `functions/api/ai/audio.ts:223`), and finalizes ElevenLabs credits from actual provider usage (`functions/api/ai/audio.ts:567-621`).
- The documented 6x hosted Kie.ai conversion is implemented. `HOSTED_KIE_CREDIT_MULTIPLIER = 6` is defined in `src/services/flashboard/FlashBoardPricing.ts:9-10` and used for hosted estimates (`src/services/flashboard/FlashBoardPricing.ts:67`, `src/services/flashboard/FlashBoardPricing.ts:84`, `src/services/flashboard/FlashBoardPricing.ts:115`).
- Production FlashBoard uses Cloud providers only, while development can expose BYO providers when a local key is explicitly marked default. The composer filters non-cloud services in production (`src/components/panels/flashboard/FlashBoardComposer.tsx:607`, `src/components/panels/flashboard/FlashBoardComposer.tsx:656`) and only exposes BYO services when the relevant default key is enabled (`src/components/panels/flashboard/FlashBoardComposer.tsx:660-674`).
- The dev bridge security model is real: Vite writes `.ai-bridge-token`, requires Bearer auth, and rejects non-localhost origins (`vite.config.ts:12`, `vite.config.ts:171-209`, `vite.config.ts:862-871`). Local file tools validate allowed roots (`src/services/security/fileAccessBroker.ts:62-116`). Log redaction is implemented (`src/services/security/redact.ts:16-36`) and bridge log output is redacted again before exposure (`src/services/aiTools/handlers/stats.ts:274-281`).
- Security tests exist and are wired into `npm run test:security` (`package.json:24`) with dedicated dev bridge, file access, AI policy, log redaction, and redaction tests (`tests/security/devBridgeRoutes.test.ts`, `tests/security/localFileAccess.test.ts`, `tests/unit/aiToolPolicy.test.ts`, `tests/unit/logRedaction.test.ts`, `tests/unit/redact.test.ts`).
- The issue-credit campaign doc matches code. The doc describes 1000 AI credits and the GitHub new-issue URL (`docs/features/Issue-Credit-Campaign.md:5-9`); the banner implements the same URL and copy (`src/components/common/IssueCreditCampaignBanner.tsx:5`, `src/components/common/IssueCreditCampaignBanner.tsx:57-72`).
- The privacy/legal visitor-log statement is consistent with middleware. Legal copy says path, time, geo, referrer, shortened user agent, pseudonymous visitor ID, and about one-hour retention (`src/components/common/LegalDialog.tsx:260-273`); middleware stores those fields in KV with `expirationTtl: 3600` (`functions/_middleware.ts:61-82`).

## Stale or inaccurate claims with code/file evidence

- Tool counts are stale in three places. `README.md` says "90+ exported" tools (`README.md:105`, `README.md:115`, `README.md:146`, `README.md:245`, `README.md:325`), `docs/features/AI-Integration.md` says 79 tools across 15 groups (`docs/features/AI-Integration.md:5`, `docs/features/AI-Integration.md:107`), and `index.html` says 41 tools (`index.html:35`, `index.html:149`, `index.html:154`, `index.html:174`). Code currently exports 16 definition groups from `AI_TOOLS` (`src/services/aiTools/definitions/index.ts:21`) with 86 exported `name:` entries. The 6 Gaussian definitions exist but are not imported into `AI_TOOLS` (`src/services/aiTools/definitions/gaussian.ts:3`).
- `docs/features/AI-Integration.md` is partly stale about dispatch gaps. It says both `openComposition` and `searchVideos` are unmapped (`docs/features/AI-Integration.md:107-109`, `docs/features/AI-Integration.md:283`). `openComposition` is now mapped (`src/services/aiTools/handlers/index.ts:217`). `searchVideos` remains a real gap: the definition is `searchVideos` (`src/services/aiTools/definitions/youtube.ts:9`) and policy registers `searchVideos` (`src/services/aiTools/policy/registry.ts:215-216`), but the dispatcher only maps `searchYouTube` (`src/services/aiTools/handlers/index.ts:262`).
- `index.html`'s AI-readable catalog is obsolete beyond the count. It advertises only the older 41-tool subset and still marks `searchVideos` as callable (`index.html:89`, `index.html:160`, `index.html:230`) even though the dispatcher key mismatch means that tool name returns `Unknown tool`.
- `docs/features/FlashBoard.md` lists removed/nonexistent source files: `FlashBoardWorkspace.tsx`, `FlashBoardToolbar.tsx`, and `FlashBoardCanvas.tsx` (`docs/features/FlashBoard.md:160-162`). The current flashboard component files are `FlashBoardComposer.tsx`, `FlashBoard.css`, and `useFlashBoardRuntime.ts`; no Workspace/Toolbar/Canvas files exist under `src/components/panels/flashboard/`.
- `docs/completed/misc/cloudflare-hosted-ai-setup.md` says "Hosted AI uses two different server routes" but lists three routes: `/api/ai/chat`, `/api/ai/audio`, and `/api/ai/video` (`docs/completed/misc/cloudflare-hosted-ai-setup.md:48-52`).
- Hosted AI chat logging is documented in AI setup docs, but legal/privacy docs do not clearly disclose that hosted prompts and responses are stored in D1. `chat_logs` stores `messages_json`, `response_json`, `tool_calls_json`, tokens, credit cost, duration, status, and errors (`functions/lib/chatLog.ts:9-17`, `functions/lib/chatLog.ts:103-125`). The English privacy policy's account/billing section mentions account, payment, usage, and billing data, but not hosted AI prompt/response logs (`src/components/common/LegalDialog.tsx:279-284`).
- There is entitlement ambiguity for hosted video generation. Backend entitlements define `kling_generation` separately and only Pro/Studio include it (`functions/lib/entitlements.ts:7`, `functions/lib/entitlements.ts:61-68`, `functions/lib/entitlements.ts:105-111`), but `/api/ai/video` checks only sign-in and credit balance before creating Kling/Seedance/Nano Banana tasks (`functions/api/ai/video.ts:375`, `functions/api/ai/video.ts:404`, `functions/api/ai/video.ts:444`). Docs should either state that any signed-in user with credits can use hosted generation, or code should enforce/document plan-specific generation gates.

## Recommended README changes

- Replace all "90+ exported tools" claims with the current exported count, or avoid a hard count and say "the shared AI tool catalog". If using a count today, use 86 exported tools and note that some bridge-only diagnostic handlers are policy-gated and not model-exposed.
- Clarify that `window.aiTools.list()` reflects `AI_TOOLS`, while some bridge/debug handlers such as `debugExport`, `createStressTestProjectFixture`, `getDockLayoutDebugState`, and `switchDockLayout` are handler/policy entries but not in the exported model tool catalog (`src/services/aiTools/handlers/index.ts:252-257`; `src/services/aiTools/policy/registry.ts:127-153`).
- Update the AI generation blurb to distinguish current primary paths: Cloud/Kie.ai/Seedance/Nano Banana/ElevenLabs/Suno, with PiAPI/EvoLink as development/BYO or legacy-compatible catalog paths.
- Keep the security CI claim, but be precise: `npm run test:security` plus the GitHub security workflow cover JS tests, `npm audit`, and `cargo audit` (`package.json:24`, `.github/workflows/security.yml:20`, `.github/workflows/security.yml:34`).

## Recommended docs/features changes by file

- `docs/features/AI-Integration.md`: Update the tool count and group count; change the dispatch-gap note so only `searchVideos` remains a current gap; keep the Gaussian unexported note unless Gaussian definitions are exported.
- `docs/features/AI-Integration.md`: Add a short distinction between exported model tools and policy/handler-only bridge diagnostics.
- `docs/features/FlashBoard.md`: Remove stale `FlashBoardWorkspace.tsx`, `FlashBoardToolbar.tsx`, and `FlashBoardCanvas.tsx` source references. Replace them with the current files under `src/components/panels/flashboard/`.
- `docs/features/Security.md`: Add hosted AI chat logging to the privacy/security model, including that prompts, responses, tool calls, token counts, credit costs, duration, and error state are stored in D1 for authenticated hosted chat.
- `docs/features/Issue-Credit-Campaign.md`: No change required from this scope.
- Outside `docs/features`: update `docs/completed/misc/cloudflare-hosted-ai-setup.md` "two routes" to "three routes" and update `index.html`'s AI-readable catalog/count.

## Suggested follow-up checks

- Add or fix a regression test proving `searchVideos` dispatches successfully, or rename the definition to `searchYouTube` consistently.
- Decide whether `kling_generation` is a real server-side entitlement. If yes, enforce it in `/api/ai/video`; if not, remove or restate it in plan/account docs.
- Add a privacy/legal update for hosted AI chat logs and decide retention/deletion behavior for `chat_logs`.
- Add a generated or tested source for the public `index.html` AI-readable tool catalog so it cannot drift from `AI_TOOLS`.
- Run `npm run test:security` after any security/doc-driven code changes.

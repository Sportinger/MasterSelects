# Telegram-Dev-Chat.md — audit 2026-08-02

## Verified (spot checks that held)

- The client dialog sends and polls `/api/support/chat`, polls every three seconds while open, and supports 2,000-character messages: `src/components/common/DevChatDialog.tsx`, `src/services/devChatService.ts`, `functions/api/support/chat.ts`, and `functions/lib/devChat.ts`.
- The two Cloudflare Functions and D1 schema named by the runbook exist: `functions/api/support/chat.ts`, `functions/api/support/telegram-webhook.ts`, `migrations/0012_dev_chat.sql`, and `migrations/0013_dev_chat_hardening.sql`.
- The four Telegram environment variables, local placeholders, D1 `DB` binding, and migration commands are current: `functions/lib/env.ts`, `.dev.vars.example`, `wrangler.toml`, and `package.json`.
- Webhook authentication, configured-chat filtering, optional numeric developer allowlist, direct-bot-reply requirement, correlation recovery, and update/message deduplication are implemented in `functions/api/support/telegram-webhook.ts`.
- Outbound idempotency, ambiguous-delivery `202` handling, `Retry-After: 3`, the `pending`/`delivered` status, and atomic D1 rate counters are implemented in `functions/api/support/chat.ts`, `functions/lib/devChat.ts`, and `migrations/0013_dev_chat_hardening.sql`.
- Anonymous 90-day expiry, best-effort cleanup, the default-expiry trigger, and account-delete cleanup are present in `functions/lib/devChat.ts`, `functions/api/support/chat.ts`, `functions/api/support/telegram-webhook.ts`, and `migrations/0013_dev_chat_hardening.sql`.

## Outdated or wrong (claim → reality, with file evidence)

- “If D1 cannot enforce the counter, the hosted endpoint fails closed” for both send and poll → only sends fail closed. `handleGet` in `functions/api/support/chat.ts` returns `429` for `limited` but does not handle `unavailable`; `handlePost` returns `503 rate_limit_unavailable` for `unavailable`.
- “A pending row therefore cannot block newer messages behind the normal page limit” → pending reconciliation IDs are selected in the same query and subject to `LIMIT DEV_CHAT_POLL_LIMIT` (100), so a busy conversation can require additional polls. Evidence: `functions/api/support/chat.ts` and `functions/lib/devChat.ts`.

## Noteworthy / unusual

- The dialog stores up to 12 recent conversation records locally and permits switching among them; the original runbook did not mention this client-side history. Evidence: `src/services/devChatService.ts` and `src/components/common/DevChatDialog.tsx`.
- While the dialog is closed, the Help menu polls stored conversations every 10 seconds only while the document is visible and displays an unread-reply badge. Evidence: `src/components/common/toolbar/useDevChatNotification.ts`, `src/components/common/toolbar/HelpMenu.tsx`, and `src/components/common/Toolbar.tsx`.
- Later outbound messages in one conversation are threaded as Telegram replies to the latest delivered bot message. Evidence: `functions/api/support/chat.ts` and `functions/lib/devChat.ts`.
- The outgoing Telegram payload includes a hashed conversation label, a recovery correlation UUID, anonymous/signed-in account context, optional app version, and normalized page context; the runbook only called this “support context.” Evidence: `functions/lib/devChat.ts`.
- Conversation IDs function as client-held capabilities: GET polling authorizes anonymous conversations by the UUID and expiry rather than a session identity. Evidence: `functions/api/support/chat.ts` and `src/services/devChatService.ts`.

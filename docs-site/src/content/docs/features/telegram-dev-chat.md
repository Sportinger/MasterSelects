---
title: "Telegram Dev Chat"
---

[Back to Index](/features/readme/)

Operational runbook for the two-way support chat between MasterSelects and a
private Telegram group.

---

## Overview

The editor's **Chat with dev** dialog sends a message to the hosted support API.
The backend stores the conversation in D1 and posts a corresponding bot message
to the configured Telegram group. A developer replies directly to that bot
message in Telegram. Telegram delivers the reply to the webhook, the backend
associates it with the original conversation, and the editor receives it on its
next poll.

The browser polls every three seconds while the dialog is open. Telegram calls
the webhook; the backend does not poll Telegram.

The dialog keeps up to 12 recent conversation IDs and previews in browser local
storage. While the dialog is closed, the Help menu checks those saved
conversations every 10 seconds while the page is visible and shows an unread
reply indicator.

```text
MasterSelects dialog
  -> POST /api/support/chat
  -> D1 + Telegram bot message
  <- GET /api/support/chat (every 3 seconds)

Developer reply in the private Telegram group
  -> POST /api/support/telegram-webhook
  -> D1
```

The integration uses these server-only values:

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Authenticates calls from the backend to the Bot API |
| `TELEGRAM_DEV_CHAT_ID` | Restricts delivery and accepted replies to one private group |
| `TELEGRAM_DEV_USER_IDS` | Optional comma-separated allowlist of Telegram account IDs that may answer |
| `TELEGRAM_WEBHOOK_SECRET` | Authenticates Telegram webhook requests |

Never expose these values through a `VITE_` variable, client bundle, issue,
commit, screenshot, or log.

---

## 1. Create the Bot and Private Group

1. Open the verified `@BotFather` account in Telegram.
2. Send `/newbot` and follow the prompts.
3. Copy the generated token into a password manager. Treat it as a password:
   anyone who has it controls the bot.
4. Create a new **private** Telegram group for MasterSelects developer messages.
5. Add the new bot to that group. It does not need administrator rights.

Keep Telegram's default **Privacy Mode enabled**. With Privacy Mode, the bot
receives replies to its own messages, which is exactly the supported workflow.
There is no need to let the bot read unrelated group traffic.

Telegram reference:

- [Creating a bot with BotFather](https://core.telegram.org/bots/tutorial#obtain-your-bot-token)
- [Group Privacy Mode](https://core.telegram.org/bots/features#privacy-mode)

---

## 2. Determine the Group Chat ID

Do this before registering the webhook:

1. Send a message in the group that addresses the bot, for example
   `/start@your_bot_username`, or reply to one of its messages.
2. In a private terminal prompt, enter the bot token without saving it in a
   command or script:

   ```powershell
   $botToken = Read-Host 'Telegram bot token'
   $updates = Invoke-RestMethod "https://api.telegram.org/bot$botToken/getUpdates"
   $updates.result | ConvertTo-Json -Depth 20
   ```

3. Find the update for the private group and copy its `message.chat.id`.
   Group IDs are negative numbers. Store the full value, including the minus
   sign, as `TELEGRAM_DEV_CHAT_ID`.
4. For a stricter production setup, also copy the numeric `message.from.id` of
   every developer who may answer. Join those IDs with commas and store the
   result as `TELEGRAM_DEV_USER_IDS`. Do not use usernames: they can change and
   are not the Bot API sender identity.
5. Clear the temporary shell variable:

   ```powershell
   Remove-Variable botToken, updates
   ```

If `getUpdates` reports that a webhook is already active, remove or inspect the
existing webhook before continuing. Do not replace an unknown production
webhook casually:

```powershell
$botToken = Read-Host 'Telegram bot token'
Invoke-RestMethod "https://api.telegram.org/bot$botToken/getWebhookInfo"
```

---

## 3. Configure Local Development

Copy the Telegram placeholders from `.dev.vars.example` into `.dev.vars` and
replace them locally:

```dotenv
TELEGRAM_BOT_TOKEN=replace-me
TELEGRAM_DEV_CHAT_ID=-1000000000000
TELEGRAM_DEV_USER_IDS=123456789,987654321
TELEGRAM_WEBHOOK_SECRET=replace-me-with-a-random-hex-string
```

Generate a webhook secret instead of inventing one:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

`.dev.vars` is local and must remain uncommitted. For normal local API work:

```powershell
npm run dev:api
```

Telegram requires a public HTTPS webhook. A local Wrangler URL cannot receive
Telegram replies unless it is deliberately exposed through a trusted HTTPS
tunnel. Prefer exercising the deployed webhook with a separate test bot and
test group. Do not point the production bot at a temporary local tunnel.

---

## 4. Apply the D1 Migration

Apply migrations locally before testing:

```powershell
npm run cf:migrate:local
```

Apply them to the remote D1 database before deploying code that reads or writes
the new chat tables:

```powershell
npm run cf:migrate:remote
```

The commands use the `DB` binding and `migrations_dir` configured in
`wrangler.toml`. The base integration schema is defined by
`migrations/0012_dev_chat.sql`; idempotency, retention, account-delete cleanup,
and atomic rate counters are added by
`migrations/0013_dev_chat_hardening.sql`. Apply both in order. Review the
migration output and confirm that the intended database is selected. Re-running
a recorded D1 migration is safe; Wrangler tracks applied migration files.

---

## 5. Set Cloudflare Secrets

Set each value through Wrangler's interactive prompt. Do not place the actual
values in `wrangler.toml`:

```powershell
npx wrangler pages secret put TELEGRAM_BOT_TOKEN --project-name masterselects
npx wrangler pages secret put TELEGRAM_DEV_CHAT_ID --project-name masterselects
npx wrangler pages secret put TELEGRAM_DEV_USER_IDS --project-name masterselects
npx wrangler pages secret put TELEGRAM_WEBHOOK_SECRET --project-name masterselects
```

`TELEGRAM_DEV_USER_IDS` is optional. When it is unset, any human member of the
configured private group can answer by replying to a bot message. Set it when
the group has more members than the trusted developer responders. Invalid or
unlisted senders are terminally ignored by the webhook (`200` with
`{"ignored":true,"ok":true}`), never enter D1, and are not retried by
Telegram. A malformed configured CSV fails closed in the same way: nobody is
allowed until the value is corrected.

If the Cloudflare Pages project uses a different project name, substitute the
exact name shown by:

```powershell
npx wrangler pages project list
```

Deploy the application after the migration and secret configuration. Confirm
that the deployed webhook route exists before registering it with Telegram.

---

## 6. Register the Production Webhook

The production webhook URL is:

```text
https://www.masterselects.com/api/support/telegram-webhook
```

Register it together with the same random value stored as
`TELEGRAM_WEBHOOK_SECRET`:

```powershell
$botToken = Read-Host 'Telegram bot token'
$webhookSecret = Read-Host 'Telegram webhook secret'
$body = @{
  url = 'https://www.masterselects.com/api/support/telegram-webhook'
  secret_token = $webhookSecret
  allowed_updates = @('message')
  drop_pending_updates = $false
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "https://api.telegram.org/bot$botToken/setWebhook" `
  -ContentType 'application/json' `
  -Body $body

Remove-Variable botToken, webhookSecret, body
```

Telegram sends `secret_token` back in the
`X-Telegram-Bot-Api-Secret-Token` request header. The webhook rejects requests
whose header does not exactly match the configured secret.

Verify registration without printing the bot token:

```powershell
$botToken = Read-Host 'Telegram bot token'
Invoke-RestMethod "https://api.telegram.org/bot$botToken/getWebhookInfo" |
  Select-Object url, pending_update_count, last_error_date, last_error_message
Remove-Variable botToken
```

The returned URL must match the production route. A non-empty
`last_error_message` or a growing `pending_update_count` means delivery needs
attention.

Telegram reference:

- [`setWebhook` and `secret_token`](https://core.telegram.org/bots/api#setwebhook)

---

## Reply Workflow

1. A user opens **Chat with dev** and sends a message.
2. The private Telegram group receives a bot message containing the support
   context.
3. In Telegram, select **Reply** on that exact bot message.
4. Write the response and send it.
5. Leave the browser dialog open, or reopen it. The reply appears after the next
   three-second poll.

Only a direct reply to the bot message is associated with a MasterSelects
conversation. A standalone group message is intentionally ignored. Messages
from any other Telegram chat are also ignored, even if the webhook receives
them.

If multiple requests are active, always reply to the corresponding bot message.
This is the thread key; quoting or manually copying text does not create the
association.

For a single MasterSelects conversation, each user message after the first is
posted by the bot as a Telegram reply to the latest delivered bot message in that
conversation. Developer replies must still use Telegram's **Reply** action on
the bot message that carries the request being answered.

Each MasterSelects bot message contains an internal `MasterSelects ref`. If
Telegram delivers a valid direct reply before the normal bot-message mapping
was committed, the webhook uses that reference to recover the pending outgoing
message and save the mapping and developer reply together. Users do not need to
copy or enter the reference.

If a MasterSelects-looking reply cannot yet be recovered, the webhook returns
`503 telegram_reply_mapping_pending` with `Retry-After: 3` instead of
acknowledging and discarding it, so Telegram can retry. Clearly unrelated bot
messages are acknowledged and ignored. Repeated deliveries remain safe because
Telegram update/message IDs are unique in D1.

---

## Delivery Idempotency and Rate Limits

Each browser send attempt carries a generated `clientMessageId`. Retrying the
same unchanged failed draft reuses that ID. The backend stores it uniquely. If
the original delivery is recorded as `delivered`, a retry returns the same
message with `201` and does not call Telegram again. If delivery is still
`pending`, both the original ambiguous result and its retry return `202` with
the pending message and `Retry-After: 3`; the retry deliberately does not call
Telegram again. The dialog marks that message as **Delivery pending**.

Polling advances normally and also asks the backend to reconcile a small set of
known pending message IDs. Reconciliation rows share the normal 100-message
response limit, so a busy conversation can require further polls to return all
newer messages. After normal confirmation or webhook reference recovery changes
a pending message to `delivered`, the pending badge disappears; a stale response
can never downgrade it back to `pending`.

Only a valid Telegram JSON response with `{"ok":false}` is a definitive
rejection: the backend rolls back the pending row, returns
`502 telegram_delivery_failed`, and allows the same `clientMessageId` to be
retried safely. A bare HTTP error or malformed/non-JSON response remains
ambiguous and returns the `202` pending message without resending it. Editing
the draft or starting a new conversation generates a new ID.

Send and poll rate limits use an atomic D1 counter per identity, scope, and
minute. Concurrent requests cannot all read the same stale counter value.
Expired counter rows are removed best-effort. If D1 cannot enforce the counter,
send requests fail closed temporarily instead of silently disabling abuse
protection; polling continues when its counter is unavailable.

---

## Data Retention

Anonymous conversations expire 90 days after their last activity. Their
messages are removed with the conversation through the D1 foreign-key cascade.
Activity extends the expiry. Cleanup is best-effort during normal dev-chat
traffic, so deletion can happen shortly after the exact expiry time rather than
at a guaranteed scheduled second. The hardening migration also installs a D1
default-expiry trigger, so a newly inserted conversation still receives the
90-day default if a write path omits an explicit expiry value.

Signed-in conversations are associated with the account and are not subject to
the anonymous 90-day expiry. Deleting the owning account cascades to its
developer-chat conversations and messages.

---

## Verification Checklist

After the first deployment:

- Open **Chat with dev** while signed in.
- Send a unique, non-sensitive test message.
- Confirm that it appears once in the configured private group.
- Reply directly to the bot message.
- Confirm that the reply appears once in the dialog within a few seconds.
- Refresh or reopen the dialog and confirm that both messages persist.
- Send a normal standalone group message and confirm that it does not appear in
  the dialog.
- If `TELEGRAM_DEV_USER_IDS` is configured, have an unlisted test account reply
  and confirm that the reply is rejected and not stored.
- Retry one browser send with the same `clientMessageId` and confirm that only
  one Telegram bot message and one D1 user message exist.
- Inspect `getWebhookInfo` and confirm that no delivery error is reported.

Do not use real customer data for smoke tests.

---

## Troubleshooting

### Outbound message is not delivered

- Confirm `TELEGRAM_BOT_TOKEN` and `TELEGRAM_DEV_CHAT_ID` are set in the same
  Cloudflare Pages environment that serves the site.
- Confirm the bot is still a member of the configured private group.
- Confirm the stored chat ID includes its leading minus sign.
- Check the support API response and Cloudflare Function logs, without logging
  secret values.

### Reply never reaches MasterSelects

- Use **Reply** on the bot's original message; standalone messages are ignored.
- Confirm the webhook URL through `getWebhookInfo`.
- Check `last_error_message` and `pending_update_count`.
- Confirm Telegram and Cloudflare use the same `TELEGRAM_WEBHOOK_SECRET`.
- Confirm the reply is in the configured group, not a similarly named group.
- If `TELEGRAM_DEV_USER_IDS` is set, confirm the responder's numeric
  `message.from.id` is present in the comma-separated list.

### Reply appears twice

Telegram retries webhook delivery when it does not receive a successful `2xx`
response. The webhook stores Telegram update/message identifiers and must treat
duplicates as success without inserting a second chat message. Check D1 and
Function logs for repeated delivery errors; do not try to solve this by
disabling retries.

---

## Rotation and Disablement

To rotate the webhook secret:

1. Generate a new random secret.
2. update `TELEGRAM_WEBHOOK_SECRET` in Cloudflare;
3. redeploy if the platform does not make the updated secret immediately
   available to Functions;
4. call `setWebhook` again with the same URL and the new `secret_token`;
5. verify with a new test reply.

A short interruption between steps 2 and 4 is expected, so perform rotation
during a quiet window.

If the bot token is exposed, revoke it immediately through `@BotFather`, store
the replacement as `TELEGRAM_BOT_TOKEN`, and register the webhook using the new
token.

To deliberately stop inbound Telegram delivery:

```powershell
$botToken = Read-Host 'Telegram bot token'
Invoke-RestMethod `
  -Method Post `
  -Uri "https://api.telegram.org/bot$botToken/deleteWebhook" `
  -ContentType 'application/json' `
  -Body (@{ drop_pending_updates = $false } | ConvertTo-Json)
Remove-Variable botToken
```

Removing the webhook does not delete D1 conversation history.

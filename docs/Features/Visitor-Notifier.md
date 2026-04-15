# Visitor Notifier

[Back to Index](./README.md)

Operational sidecar for monitoring site visits through Cloudflare Pages/KV and a Windows tray notifier.

---

## Overview

This is not part of the editing UI. It is an ops/support toolchain around `masterselects.com`.

The system has two halves:

- Cloudflare Pages middleware records visit events into KV
- a Windows tray app polls `/api/visits` and shows local notifications for new visitors

---

## Server Side

### Visit Capture

`functions/_middleware.ts` records page visits in the background and writes new entries under the `visit2:` KV prefix.

Stored metadata can include:

- timestamp
- path
- country / city
- user agent
- referer
- derived `visitorId`

### Visit Feed

`GET /api/visits` returns recent visits from KV.

Requirements:

- `VISITOR_NOTIFY_SECRET` must be configured
- callers pass the secret as a query parameter or `x-visitor-secret` header
- optional `since` and `limit` parameters filter the response

The route merges both `visit2:` and legacy `visit:` keys, sorts newest-first, and returns a compact JSON payload.

---

## Windows Tray App

The tray client lives in `tools/visitor-tray/`.

Main files:

- `VisitorTray.ps1`
- `start.cmd`
- `start-debug.cmd`
- `Install-Startup.ps1`
- `Install-DesktopShortcut.ps1`

Behavior:

- polls `/api/visits`
- plays an alert sound
- shows balloon notifications
- opens the visited site/path when the notification is clicked
- groups repeated visits when a stable `visitorId` is available

---

## Configuration

The tray app reads configuration from:

1. repo `.dev.vars`
2. repo `.dev.vars.local`
3. `tools/visitor-tray/.env.local`
4. process environment variables

Important values:

- `VISITOR_NOTIFY_SECRET`
- `SITE_URL`
- optional `HISTORY_LIMIT`
- optional `ALERT_SOUND_PATH`

---

## Limitations

- the tray app is Windows-only
- this workflow is operational tooling, not a shipped editor feature
- without `VISITOR_NOTIFY_SECRET`, `/api/visits` rejects requests

---

## Related Features

- [Hosted AI Setup](../cloudflare-hosted-ai-setup.md)
- [Security](./Security.md)

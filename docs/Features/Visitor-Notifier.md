# Visitor Notifier

[Back to Index](./README.md)

Operational sidecar for monitoring site visits through Cloudflare Pages/KV and a Windows tray notifier.

---

## Overview

This is an ops/support toolchain around `masterselects.com`.

The system has two halves:

- Cloudflare Pages middleware records visit events into KV
- a Windows tray app polls `/api/visits` and shows local notifications for new visitors

---

## Server Side

### Visit Capture

`functions/_middleware.ts` records eligible page visits in the background and writes new entries under the `visit2:` KV prefix. It tracks only successful HTML `GET` responses outside `/api/` and skips bot-like user agents.

Unknown HTML paths return a real `404` at the Pages edge instead of loading and tracking the editor SPA fallback. Known entry paths and real static assets continue normally.

Stored metadata can include:

- timestamp
- path
- country / city
- user agent
- referer
- derived `visitorId`

Entries expire after one hour. The admin dashboard also reads `visit2:` metadata for last-hour request, unique-visitor, country, and path summaries.

### Visit Feed

`GET /api/visits` returns recent visits from KV.

Requirements:

- `VISITOR_NOTIFY_SECRET` must be configured
- callers pass the secret as a query parameter or `x-visitor-secret` header
- optional `since` and `limit` parameters filter the response

The route merges both `visit2:` and legacy `visit:` keys, sorts newest-first, and returns a compact `{ count, visits }` JSON payload. `limit` defaults to `50` and is constrained to `1`–`200`.

---

## Windows Tray App

The tray client lives in `tools/visitor-tray/`.

Main files:

- `VisitorTray.ps1`
- `start.cmd`
- `start.vbs`
- `start-debug.cmd`
- `Install-Startup.ps1`
- `Install-DesktopShortcut.ps1`

Behavior:

- polls `/api/visits`
- can play an alert sound
- shows a custom, clickable toast notification when `ENABLE_BALLOON` is enabled
- opens the visited site/path from the toast when `OPEN_SITE_ON_BALLOON_CLICK` is enabled
- provides a grouped, scrollable live log from the tray icon; stable `visitorId` values are the primary grouping key

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
- optional `POLL_INTERVAL_MS`, `MAX_VISITS_PER_POLL`, and `ALERT_SECONDS`
- optional `ENABLE_SOUND`, `ENABLE_BALLOON`, and `OPEN_SITE_ON_BALLOON_CLICK`
- optional `HISTORY_LIMIT`
- optional `ALERT_SOUND_PATH`

---

## Limitations

- the tray app is Windows-only
- this workflow is operational tooling
- without `VISITOR_NOTIFY_SECRET`, `/api/visits` rejects requests

---

## Related Features

- [Hosted AI Setup](../cloudflare-hosted-ai-setup.md)
- [Security](./Security.md)

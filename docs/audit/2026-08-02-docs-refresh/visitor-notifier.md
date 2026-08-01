# Visitor-Notifier.md — audit 2026-08-02

## Verified (spot checks that held)

- `functions/_middleware.ts` is the Cloudflare Pages middleware that writes visit metadata under newest-first `visit2:` keys (`functions/_middleware.ts:74-76`, `functions/_middleware.ts:92-115`). It derives `visitorId` from `cf-connecting-ip` and `VISITOR_NOTIFY_SECRET` when both are available (`functions/_middleware.ts:79-89`).
- Unknown HTML SPA fallbacks are returned as `404`, while supported entry paths are defined by `src/routing/entryExperience.ts` (`functions/_middleware.ts:54-61`, `functions/_middleware.ts:138-147`, `src/routing/entryExperience.ts:11-17`, `src/routing/entryExperience.ts:57-66`).
- `functions/api/visits.ts` implements `GET /api/visits`, requires `VISITOR_NOTIFY_SECRET` through `secret` or `x-visitor-secret`, accepts `since` and `limit`, combines `visit2:` and legacy `visit:` keys, and sorts results newest-first (`functions/api/visits.ts:54-92`).
- The Windows client is in `tools/visitor-tray/`; the documented launch/install scripts exist, and its PowerShell entry point polls `/api/visits` using the secret header (`tools/visitor-tray/VisitorTray.ps1:645-685`, `tools/visitor-tray/start.cmd`, `tools/visitor-tray/start-debug.cmd`, `tools/visitor-tray/Install-Startup.ps1`, `tools/visitor-tray/Install-DesktopShortcut.ps1`).
- The documented config precedence is correct: `.dev.vars`, `.dev.vars.local`, tool `.env.local`, then process environment values (`tools/visitor-tray/VisitorTray.ps1:50-90`).
- The tray client is Windows-only and `/api/visits` rejects absent or incorrect secrets with `401` (`tools/visitor-tray/VisitorTray.ps1:4-6`, `functions/api/visits.ts:59-65`).

## Outdated or wrong (claim → reality, with file evidence)

- “shows balloon notifications” → `Show-Balloon` is a legacy function name, but it creates and displays a custom WinForms toast window; it is not a native `NotifyIcon.ShowBalloonTip` notification. The toast is clickable and hides after five seconds (`tools/visitor-tray/VisitorTray.ps1:910-1012`, `tools/visitor-tray/VisitorTray.ps1:1024-1073`).
- “opens the visited site/path when the notification is clicked” → this is conditional on `OPEN_SITE_ON_BALLOON_CLICK`, which defaults to `true`; the setting can disable opening the path (`tools/visitor-tray/VisitorTray.ps1:1053-1065`, `tools/visitor-tray/VisitorTray.ps1:1535-1542`).

## Noteworthy / unusual

- Visit capture is narrower than the original overview implies: only successful HTML `GET` responses outside `/api/` are tracked, bot-like user agents are excluded, and each KV entry has a one-hour TTL (`functions/_middleware.ts:42-51`, `functions/_middleware.ts:108-115`).
- The endpoint returns `{ count, visits }`; `limit` defaults to `50` and is clamped to `1`–`200` (`functions/api/visits.ts:68-74`, `functions/api/visits.ts:94-97`).
- The tray has shipped capabilities omitted by the previous feature doc: a right-click live log, a double-click site opener, fallback grouping when no `visitorId` exists, bundled WAV playback, and configurable polling, sound, toast, and alert settings (`tools/visitor-tray/VisitorTray.ps1:492-515`, `tools/visitor-tray/VisitorTray.ps1:1533-1542`, `tools/visitor-tray/VisitorTray.ps1:1582-1596`).
- The authenticated admin dashboard separately aggregates current `visit2:` metadata for requests, unique visitors, countries, and paths (`functions/lib/cloudflareAdmin.ts:203-225`, `functions/lib/adminDashboard.ts:201-205`, `src/admin/AdminPage.tsx:701-704`).
- `scripts/visit-notifier.mjs` remains a separate cross-platform command-line polling notifier, but it is not exposed in `package.json` and is not mentioned by the feature document (`scripts/visit-notifier.mjs:1-13`, `scripts/visit-notifier.mjs:101-139`, `package.json:scripts`).
- `docs-site/src/content/docs/features/visitor-notifier.md` is a separate, stale copy of this feature page. It preserves the native-“balloon” claim and the omitted capabilities; it was intentionally not changed because this audit was limited to two files (`docs-site/src/content/docs/features/visitor-notifier.md:1-99`).

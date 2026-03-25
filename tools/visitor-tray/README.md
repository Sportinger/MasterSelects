# Visitor Tray

Windows tray notifier for new visits on `masterselects.com` / `www.masterselects.com`.

It uses the existing Cloudflare Pages endpoint at `/api/visits` and stays isolated from the main app build.

## Files

- `VisitorTray.ps1`: tray app
- `start.cmd`: launch hidden in the system tray
- `start-debug.cmd`: launch with visible PowerShell window
- `Install-Startup.ps1`: add a Startup shortcut for Windows logon
- `Uninstall-Startup.ps1`: remove the Startup shortcut
- `.env.example`: local config template

## Setup

1. Copy `.env.example` to `.env.local`.
2. Set `VISITOR_NOTIFY_SECRET` to the same value used in Cloudflare Pages production.
3. Start the tray app with `start.cmd`.

The script loads config in this order:

1. repo `.dev.vars`
2. repo `.dev.vars.local`
3. `tools/visitor-tray/.env.local`
4. process environment variables

Later sources override earlier ones.

## Required Cloudflare Secret

The tray app reads from `/api/visits`, which requires `VISITOR_NOTIFY_SECRET`.

If production does not have that secret yet, set it in Cloudflare Pages for the `masterselects` project before using the tray:

```powershell
npx wrangler pages secret put VISITOR_NOTIFY_SECRET --project-name masterselects
```

## Run

Hidden tray:

```powershell
tools\visitor-tray\start.cmd
```

Debug mode:

```powershell
tools\visitor-tray\start-debug.cmd
```

Install autostart:

```powershell
powershell -ExecutionPolicy Bypass -File tools\visitor-tray\Install-Startup.ps1
```

Remove autostart:

```powershell
powershell -ExecutionPolicy Bypass -File tools\visitor-tray\Uninstall-Startup.ps1
```

## Tray Menu

- Open MasterSelects
- Poll now
- Pause / Resume polling
- Exit

On a new visit the app:

- plays a Windows notification sound
- switches the tray icon to a warning icon for a few seconds
- shows a balloon notification

Clicking the balloon opens the latest visited path on the site.

## Notes

- This tool is Windows-only.
- It intentionally does not touch `package.json` or the website build.
- The server now writes new visit events under a `visit2:` KV prefix so recent visits can be read newest-first.

# Visitor Tray

Windows tray notifier for new visits on `masterselects.com` / `www.masterselects.com`.

It uses the existing Cloudflare Pages endpoint at `/api/visits` and stays isolated from the main app build.

## Files

- `VisitorTray.ps1`: tray app
- `start.cmd`: launch hidden in the system tray
- `start.vbs`: hidden launcher without a visible console window
- `start-debug.cmd`: launch with visible PowerShell window
- `Install-Startup.ps1`: add a Startup shortcut for Windows logon
- `Uninstall-Startup.ps1`: remove the Startup shortcut
- `Install-DesktopShortcut.ps1`: create a Desktop shortcut
- `Uninstall-DesktopShortcut.ps1`: remove the Desktop shortcut
- `assets/masterselects-alert.wav`: bundled alert sound
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

Optional config:

- `HISTORY_LIMIT`: how many recent visits should be kept in the live log window. Default: `200`
- `ALERT_SOUND_PATH`: optional absolute or tool-relative path to a `.wav` file for visit alerts. If omitted, the tray uses the bundled MasterSelects alert sound and falls back to a Windows notification sound.

## Required Cloudflare Secret

The tray app reads from `/api/visits`, which requires `VISITOR_NOTIFY_SECRET`.

If production does not have that secret yet, set it in Cloudflare Pages for the `masterselects` project before using the tray:

```powershell
npx wrangler pages secret put VISITOR_NOTIFY_SECRET --project-name masterselects
```

## Run

Hidden tray without a visible console:

```powershell
tools\visitor-tray\start.cmd
```

Debug mode with a visible PowerShell window:

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

Create a Desktop shortcut:

```powershell
powershell -ExecutionPolicy Bypass -File tools\visitor-tray\Install-DesktopShortcut.ps1
```

Remove the Desktop shortcut:

```powershell
powershell -ExecutionPolicy Bypass -File tools\visitor-tray\Uninstall-DesktopShortcut.ps1
```

## Tray UI

- Right-click the tray icon to open the live log window.
- The live log shows recent visits in a scrollable list.
- Repeated hits from the same tracked visitor are grouped into expandable rows when a stable visitor id is available.
- Double-click the tray icon still opens MasterSelects in the browser.

On a new visit the app:

- plays a notification sound from `ALERT_SOUND_PATH`, otherwise the bundled MasterSelects alert sound, otherwise a Windows notification sound fallback
- switches the tray icon to a warning icon for a few seconds
- shows a balloon notification with the country flag when available

Clicking the balloon opens the latest visited path on the site.

## Notes

- This tool is Windows-only.
- It intentionally does not touch `package.json` or the website build.
- The server now writes new visit events under a `visit2:` KV prefix so recent visits can be read newest-first.

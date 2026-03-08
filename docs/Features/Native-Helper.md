# Native Helper

The Native Helper is an optional companion application that provides download acceleration (via yt-dlp) and file system access (for Firefox project persistence) over WebSocket.

## Overview

The Native Helper is a lightweight Rust binary that runs locally and communicates with the MasterSelects web app over WebSocket. It provides two main capabilities:

1. **Downloads**: YouTube, TikTok, Instagram, Twitter/X, and other platforms via yt-dlp
2. **File System Access**: Read/write files, create directories, folder picker -- primarily used for Firefox project persistence (since Firefox lacks the File System Access API)

> **Note**: The browser-side code (`src/services/nativeHelper/`) still contains protocol types for video decode/encode commands (`open`, `decode`, `prefetch`, `start_encode`, etc.) and a `NativeDecoder` class. These are **not implemented on the server side** and represent either planned future functionality or remnants from a previous design. The actual Rust server only handles downloads and file system operations.

## Features

- **YouTube downloads** -- Fast downloads via yt-dlp integration
- **Multi-platform downloads** -- TikTok, Instagram, Twitter/X, and other platforms via yt-dlp
- **Format selection** -- List available formats and choose quality/codec before downloading
- **File system operations** -- Write files, create directories, list/delete/rename, check existence
- **Folder picker** -- Native OS folder picker dialog (for Firefox project folder selection)
- **Firefox persistence** -- Enables full project save/load on Firefox via file system commands
- **System tray** -- On Windows, runs as a system tray app with auto-start and self-update support

## Architecture

```
Browser (MasterSelects App)
    |
    | WebSocket (ws://127.0.0.1:9876)
    | HTTP file server (http://127.0.0.1:9877)
    |
    v
Native Helper (Rust)
    |
    | yt-dlp (subprocess)
    | File system (direct)
    |
    v
Local file system
```

## Installation

### Linux

1. Download the helper from the toolbar (click the Turbo indicator) or from [GitHub Releases](https://github.com/Sportinger/MASterSelects/releases/latest)
2. Make it executable: `chmod +x masterselects-helper`
3. Run it: `./masterselects-helper`

The helper will automatically be detected by the app.

### Windows

1. Download from the toolbar or [GitHub Releases](https://github.com/Sportinger/MASterSelects/releases/latest)
2. Run `masterselects-helper.exe` (runs as system tray app by default)
3. Use `--console` flag to run in terminal mode instead of tray mode

### macOS

1. Download from the toolbar or [GitHub Releases](https://github.com/Sportinger/MASterSelects/releases/latest)
2. Make executable and run: `chmod +x masterselects-helper && ./masterselects-helper`

### Options

```bash
masterselects-helper [OPTIONS]

Options:
  -p, --port <PORT>              Port to listen on [default: 9876]
      --background               Run in background (minimal output)
      --allowed-origins <LIST>   Allowed origins (comma-separated, empty = all localhost)
      --generate-token           Generate and print auth token, then exit
      --log-level <LEVEL>        Log level (trace/debug/info/warn/error) [default: info]
      --console                  Run in console mode (Windows only; Linux/macOS always console)
  -h, --help                     Print help
  -V, --version                  Print version
```

## Usage

### Enabling Turbo Mode

1. Run the Native Helper
2. The toolbar will show "Turbo" when connected
3. Downloads and Firefox file system operations are now available

### Status Indicator

The toolbar shows the helper status:
- Not connected (click for download)
- **Turbo** - Connected and active

Click the indicator for details:
- Helper version
- yt-dlp availability
- Download directory

## Protocol

### WebSocket Commands

The helper communicates via WebSocket (port 9876) with JSON commands:

| Command | Purpose |
|---------|---------|
| `auth` | Authenticate with token |
| `info` | Get system info (version, yt-dlp status, etc.) |
| `ping` | Connection keepalive |
| `download_youtube` | Download video via yt-dlp (legacy command name) |
| `download` | Generic download via yt-dlp (all platforms) |
| `list_formats` | List available formats for a video URL |
| `get_file` | Get a file from local filesystem |
| `locate` | Locate a file by name in common directories |
| `write_file` | Write data to a file (text or base64) |
| `create_dir` | Create a directory |
| `list_dir` | List directory contents |
| `delete` | Delete a file or directory |
| `exists` | Check if a path exists |
| `rename` | Rename or move a file/directory |
| `pick_folder` | Open native OS folder picker dialog |

### HTTP File Server

An HTTP file server runs on port 9877 (WebSocket port + 1) for serving downloaded files to the browser.

### Security

- **Localhost only** -- Binds to 127.0.0.1
- **Origin validation** -- Only accepts connections from allowed origins
- **Auth token** -- Optional token-based authentication
- **No external network access** -- Only local file system and yt-dlp subprocess

## Technical Details

### Source Code

The helper is a unified Rust binary:
```
tools/native-helper/
  Cargo.toml
  src/
    main.rs          # Entry point, CLI args, platform setup
    server.rs        # WebSocket + HTTP server
    session.rs       # Auth token management, command dispatch, file system ops
    utils.rs         # Shared utilities
    download/
      mod.rs
      ytdlp.rs       # yt-dlp integration
    protocol/
      mod.rs
      commands.rs     # Command/Response types, error codes
```

Windows-specific modules:
```
    tray.rs          # System tray icon and menu
    updater.rs       # Self-update from GitHub Releases
```

### Browser Client Code

```
src/services/nativeHelper/
  NativeHelperClient.ts  # WebSocket client (singleton)
  NativeDecoder.ts       # Decoder wrapper (NOT used by current server)
  protocol.ts            # Message types (includes unused decode/encode types)
  index.ts               # Re-exports
```

> The `NativeDecoder.ts` and decode/encode related types in `protocol.ts` define a video decode/encode protocol that is **not implemented** in the current Rust server. These are retained for potential future use.

### Dependencies (Cargo.toml)

- **tokio** -- Async runtime
- **tokio-tungstenite** -- WebSocket
- **warp** -- HTTP file server
- **clap** -- CLI argument parsing
- **serde/serde_json** -- JSON serialization
- **rfd** -- Native file dialog (folder picker)
- **tray-icon** (Windows) -- System tray
- **winreg** (Windows) -- Registry for auto-start
- **ureq** (Windows) -- HTTP client for self-update

Build with:
```bash
cd tools/native-helper
cargo build --release
```

## Troubleshooting

### Helper not detected

1. Check if running: `ps aux | grep masterselects-helper`
2. Check port: `ss -tlnp | grep 9876`
3. Try restart: Kill and run again
4. Check browser console for WebSocket errors

### Downloads not working

1. Check yt-dlp is installed and available on PATH
2. Run `yt-dlp --version` to verify
3. Check helper log output for errors

### Connection errors

1. Check firewall allows localhost:9876
2. Ensure only one instance running
3. On Windows, try `--console` flag to see log output

---

## Tests

No dedicated unit tests -- this is a Rust binary tested separately.

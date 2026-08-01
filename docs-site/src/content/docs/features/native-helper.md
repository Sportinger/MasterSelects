---
title: "Native Helper"
---

[← Back to Index](/features/readme/)


The Native Helper is a local companion application that provides Firefox project persistence, external AI control, yt-dlp-based downloads, and isolated local-AI runtimes.

## Overview

The Native Helper is a lightweight Rust binary that runs locally and communicates with the MasterSelects web app over WebSocket and HTTP. Its main capabilities are:

1. **Downloads**: YouTube, TikTok, Instagram, Twitter/X, and other platforms via yt-dlp
2. **File System Access**: Read/write files, create directories, folder picker -- primarily used for Firefox project persistence (since Firefox lacks the File System Access API)
3. **AI Bridge**: Forward AI tool calls from local agents to the running MasterSelects editor session
4. **Local AI Providers**: Provision and supervise isolated MatAnyone2 and MuScriptor Python sidecars

The browser client can discover the auth token automatically from `GET /startup-token` on the local HTTP server, then authenticate over WebSocket/HTTP as needed.

> **Note**: The browser-side code (`src/services/nativeHelper/`) contains protocol types for video decode/encode commands (`open`, `decode`, `prefetch`, `start_encode`, etc.) and a `NativeDecoder` class. The shipped helper handles downloads, file system operations, and the MatAnyone2 and MuScriptor job protocols. It does not expose editor tools to external agents.

## Features

- **YouTube downloads** -- Fast downloads via yt-dlp integration
- **Multi-platform downloads** -- TikTok, Instagram, Twitter/X, and other platforms via yt-dlp
- **Format selection** -- List available formats and choose quality/codec before downloading
- **File system operations** -- Write files, create directories, list/delete/rename, check existence
- **Folder picker** -- Native OS folder picker dialog (for Firefox project folder selection)
- **Picked-folder grants** -- Folder picker and restore paths are registered as allowed roots so projects outside the default Documents folder can be opened and served through the helper
- **Manual path fallback** -- If the helper cannot show a native folder picker on the current platform, the web app prompts for the project folder path instead
- **Firefox persistence** -- Enables full project save/load on Firefox via file system commands
- **MatAnyone2 video matting** -- Pinned local runtime, model cache, persistent inference sidecar, transparent VP9/WebM output, progress, and cancellation
- **MuScriptor music-to-MIDI** -- Pinned isolated runtime, gated model variants, persistent transcription sidecar, instrument constraints, progress, and cancellation
- **System tray** -- On Windows, runs as a system tray app with auto-start and self-update support
- **Temp download dir** -- yt-dlp writes to the helper's local download folder (`temp/masterselects-downloads`) before files are copied into a project
- **Default project root** -- projects are created under `Documents/MasterSelects` when available, otherwise `Home/MasterSelects`, unless `MASTERSELECTS_PROJECT_ROOT` is set to an absolute path

## Architecture

```
Browser (MasterSelects App)
    |
    | WebSocket (ws://127.0.0.1:9876)
    | HTTP server (http://127.0.0.1:9877)
    |
    v
Native Helper (Rust)
    |
    | bundled or system yt-dlp (subprocess)
    | File system (direct)
    | MatAnyone2 / MuScriptor sidecar control
    |
    v
Local file system
```

## Installation

### Linux

1. Download the helper from the Native Helper lightning-icon dialog in the toolbar or from [GitHub Releases](https://github.com/Sportinger/MasterSelects/releases/latest)
2. Make it executable: `chmod +x masterselects-helper`
3. Run it: `./masterselects-helper`

The helper will automatically be detected by the app.

### Windows

1. Download the latest Windows MSI from the Native Helper lightning-icon dialog in the toolbar or [GitHub Releases](https://github.com/Sportinger/MasterSelects/releases/latest)
2. Run the MSI installer. It installs `yt-dlp.exe` next to `masterselects-helper.exe`, so downloads do not need a separate `pip install yt-dlp`
3. Launch `masterselects-helper.exe` if it does not auto-start
4. Use `--console` flag to run in terminal mode instead of tray mode

### macOS

1. Download from the Native Helper lightning-icon dialog in the toolbar or [GitHub Releases](https://github.com/Sportinger/MasterSelects/releases/latest)
2. Follow the platform-specific release instructions; the current UI describes moving a macOS app to Applications and launching it once.

### Options

```bash
masterselects-helper [OPTIONS]

Options:
  -p, --port <PORT>              Port to listen on [default: 9876]
      --background               Run in background (minimal output)
      --allowed-origins <LIST>   Additional allowed origins (comma-separated)
      --generate-token           Generate and print auth token, then exit
      --log-level <LEVEL>        Log level (trace/debug/info/warn/error) [default: info]
      --console                  Run in console mode (Windows only; Linux/macOS always console)
      --no-auth                  Disable authentication (not recommended)
  -h, --help                     Print help
  -V, --version                  Print version
```

## Usage

### Enabling the Native Helper

1. Run the Native Helper
2. Enable Native Helper in its dialog; the toolbar lightning icon becomes active when connected
3. Downloads and Firefox file system operations are available
4. If the helper starts with auth enabled, the browser can usually discover the token automatically from `/startup-token`

### Status Indicator

The toolbar uses a lightning icon. Its dialog shows one of:
- **Disabled** -- Native Helper is disabled in settings
- **Not running** -- Native Helper is enabled but disconnected
- **Connected** -- Native Helper is connected and active

Click the indicator for details:
- Helper version
- yt-dlp availability (bundled next to the helper or installed on PATH)
- Project and MatAnyone2 capability status
- Published-release and app-target version status

## Protocol

### WebSocket Commands

The helper communicates via WebSocket (port 9876) with JSON commands:

| Command | Purpose |
|---------|---------|
| `auth` | Authenticate with token |
| `info` | Get system info (version, yt-dlp status, etc.) |
| `ping` | Connection keepalive |
| `download_youtube` | Download video via yt-dlp |
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
| `grant_path` | Register an absolute project path as an allowed root |
| `pick_folder` | Open native OS folder picker dialog |
| `mat_anyone_*` | GPU-only MatAnyone2 setup, model download, inference, cancel, uninstall (NVIDIA CUDA required; no CPU fallback) |
| `muscriptor_*` | MuScriptor status, setup, gated model download, start/stop, transcribe, cancel, uninstall |

### HTTP Server

An HTTP server runs on port 9877 (WebSocket port + 1).

| Endpoint | Purpose |
|---------|---------|
| `GET /file?path=...` | Serve local files to the browser (auth required) |
| `POST /upload?path=...` | Upload/write local files efficiently (auth required) |
| `GET /project-root` | Return the default project root (no auth) |
| `GET /startup-token` | Return the current auth token for local discovery (no auth) |

### Security

- **Localhost only** -- Binds to 127.0.0.1
- **Origin validation** -- Only accepts connections from allowed origins
- **Auth token** -- Token-based authentication for HTTP and WebSocket bridge operations
- **Scoped external access** -- Network access is used only for requested downloads such as yt-dlp, pinned provider source, and model weights; inference stays local
- **Allowed origins** -- WebSocket connections accept localhost and Cloudflare Pages origins; the configured defaults additionally list the MasterSelects production, staging, and local-development origins. Add preview origins with `--allowed-origins` when HTTP CORS requires them.
- **Sidecar path policy** -- Local-AI inputs and outputs are checked against project/granted roots or the exact provider temp root before subprocess access
- **Transient model credentials** -- Gated HuggingFace tokens are passed only to the model-download subprocess and are excluded from command logging

## Technical Details

### Source Code

The helper is a unified Rust binary:
```
tools/native-helper/
  Cargo.toml
  src/
    main.rs          # Entry point, CLI args, platform setup
    server.rs        # Server orchestration and shared state
    http_server.rs   # Authenticated HTTP health and local-file routes
    websocket_server.rs # Authenticated WebSocket command dispatch
    session.rs       # Session state and command coordination
    session/
      file_commands.rs      # File grants, reads, and staging
      matanyone_commands.rs # MatAnyone2 command routing
    utils.rs         # Shared utilities
    download/
      mod.rs
      ytdlp.rs       # yt-dlp integration
    protocol/
      mod.rs
      commands.rs     # Command/Response types, error codes
    matanyone/        # MatAnyone2 model, process, and inference
      env.rs          # Environment orchestration
      env/            # Platform, source, and bootstrap stages
    muscriptor/       # MuScriptor environment, process, control, inference
  python/
    matanyone2_server.py
    muscriptor_server.py
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
  NativeDecoder.ts       # Video decoder wrapper
  protocol.ts            # Message types
  nativeHelper*Commands.ts # Download, file, MatAnyone2, MuScriptor, and video command adapters
  nativeHelperMessageHandler.ts # Response and progress dispatch
  releases.ts            # Helper release target and release lookup
  index.ts               # Re-exports
```

> MatAnyone2 and MuScriptor use their own job protocols and local sidecars.

### Dependencies (Cargo.toml)

- **tokio** -- Async runtime
- **tokio-tungstenite** -- WebSocket
- **warp** -- HTTP file server
- **clap** -- CLI argument parsing
- **serde/serde_json** -- JSON serialization
- **rfd** -- Native file dialog (folder picker)
- **tray-icon** (Windows) -- System tray
- **winreg** (Windows) -- Registry for auto-start
- **ureq** -- HTTP client for model downloads and Windows self-update
- **tracing/tracing-subscriber** -- Structured logging
- **windows-sys** (Windows) -- Windows console, shell, and process APIs

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

1. On Windows, reinstall or update the helper MSI so the bundled `yt-dlp.exe` is present in the install folder
2. For source builds and non-Windows archive installs, check that `yt-dlp` is installed on PATH or placed next to the helper binary
3. Run `yt-dlp --version` or `<helper install folder>\yt-dlp.exe --version` to verify
4. Check helper log output for errors
5. If YouTube reports bot or sign-in blocking, close Chrome completely and retry so yt-dlp can read cookies

### Connection errors

1. Check firewall allows localhost:9876
2. Ensure only one instance running
3. On Windows, try `--console` flag to see log output
4. If Firefox reports the helper as disconnected after refresh, press Check connection; the web client refreshes the helper startup token on every reconnect, times out stalled reconnects, and retries every few seconds after disconnection

---

## Tests

The helper has Rust unit tests for protocol normalization, path-policy behavior, provider state, token redaction, archive selection, process helpers, and inference parsing. Browser protocol adapters and provider stores/mappers have focused Vitest coverage in `tests/unit/`.

---

## Related Documents

- [Media Downloads](/features/download-panel/) -- Media panel download UI powered by the Native Helper
- [Project Persistence](/features/project-persistence/) -- Firefox project persistence via Native Helper file system ops
- [MuScriptor Music-to-MIDI](/features/muscriptor/) -- Local audio-to-MIDI provider and timeline workflow

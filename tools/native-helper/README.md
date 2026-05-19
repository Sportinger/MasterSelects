# MasterSelects Native Helper

Cross-platform local runtime companion for MasterSelects. It provides Firefox project storage, external AI control, and yt-dlp-powered downloads.

## Features

- **External AI Control**: Local HTTP bridge for Claude Code, curl, and other agents
- **Firefox Project Storage**: Native file system backend for project save/load when FSA is unavailable
- **Video Downloads**: yt-dlp integration for YouTube, TikTok, Instagram, Twitter, etc.
- **WebSocket Protocol**: Local command channel between the browser app and helper
- **HTTP Server**: File serving plus AI tool bridge on port `port + 1`

## Prerequisites

### All Platforms
- [Rust](https://rustup.rs/) (stable)
- [LLVM/Clang](https://releases.llvm.org/) (for bindgen during compilation)

### Windows
```powershell
winget install LLVM.LLVM
```

## Building

### Windows
```powershell
set LIBCLANG_PATH=C:\Program Files\LLVM\lib
cargo build --release
cmd /c scripts\build-msi.bat
```

`scripts\build-msi.bat` downloads the official `yt-dlp.exe` release binary into `target\release` and bundles it into the MSI next to `masterselects-helper.exe`. Installed Windows helpers therefore do not require a separate `pip install yt-dlp` or system PATH setup for downloads.

### Linux / macOS
```bash
cargo build --release
```

Source builds and archive packages look for `yt-dlp` next to the helper binary first, then fall back to `yt-dlp` on `PATH`.

## Running

```bash
./target/release/masterselects-helper          # Default: WS on :9876, HTTP on :9877
./target/release/masterselects-helper --background
```

## Protocol

WebSocket (JSON commands) on port 9876, HTTP server on port 9877.

| Command | Description |
|---------|-------------|
| `ping` | Connection keepalive |
| `info` | System info (helper features, bundled/system yt-dlp status, project root, AI bridge status) |
| `register_client` | Register the running MasterSelects editor session with the helper |
| `ai_tool_result` | Return the result of a forwarded AI tool request |
| `list_formats` | List available download formats for a URL |
| `download` | Download a video with progress streaming |
| `get_file` | Get a file as base64 |
| `write_file` / `create_dir` / `list_dir` / `delete` / `exists` / `rename` / `pick_folder` | File-system operations used by the Firefox backend |

HTTP endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /file?path=...` | Serve a local file |
| `POST /upload?path=...` | Upload/write a local file |
| `GET /project-root` | Return default project root |
| `GET /api/ai-tools` | AI bridge status |
| `POST /api/ai-tools` | Forward an AI tool call to the connected editor session |

Example:

```bash
curl -X POST http://127.0.0.1:9877/api/ai-tools \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <startup-token>" \
  -d '{"tool":"_status","args":{}}'
```

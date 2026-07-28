# MasterSelects Native Helper

Cross-platform local runtime companion for MasterSelects. It provides Firefox project storage, external AI control, and yt-dlp-powered downloads.

## Features

- **External AI Control**: Local HTTP bridge for Claude Code, curl, and other agents
- **Firefox Project Storage**: Native file system backend for project save/load when FSA is unavailable
- **Video Downloads**: yt-dlp integration for YouTube, TikTok, Instagram, Twitter, etc.
- **Local AI Runtimes**: isolated MatAnyone2 video matting and MuScriptor audio-to-MIDI sidecars
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
| `matanyone_status` / `matanyone_setup` / `matanyone_download_model` | Inspect or install the pinned MatAnyone2 runtime and weights |
| `matanyone_start` / `matanyone_stop` / `matanyone_matte` / `matanyone_cancel` / `matanyone_uninstall` | Control local video matting; completed jobs return transparent VP9/WebM plus a separate alpha video |
| `muscriptor_status` / `muscriptor_setup` / `muscriptor_download_model` | Inspect or install the pinned MuScriptor runtime and a `small`, `medium`, or `large` model |
| `muscriptor_start` / `muscriptor_stop` / `muscriptor_transcribe` / `muscriptor_cancel` / `muscriptor_uninstall` | Control the persistent local music-transcription sidecar and stream note/progress events |

## Local AI setup and licensing

Both providers run locally under the user's application-data directory. The helper reuses its managed `uv` bootstrap, but keeps provider Python environments and model caches separate. No model is bundled with the helper.

MatAnyone2 is installed from the pinned upstream revision recorded in the helper source. Setup may use the managed Python runtime or the explicit `python_path` supplied by the client. Its model is downloaded separately, and inference produces a transparent VP9/WebM foreground (`alpha_mode=1`) plus a grayscale alpha WebM. MatAnyone2 uses the S-Lab License 1.0, which permits non-commercial use and requires separate permission for commercial use; review the upstream license before distribution or commercial deployment.

MuScriptor is installed from the pinned upstream revision recorded in the helper source. Its weights are gated on HuggingFace under CC BY-NC 4.0:

1. Accept the license for the selected repository (`MuScriptor/muscriptor-small`, `-medium`, or `-large`) on HuggingFace.
2. Create a read token.
3. Pass it only to `muscriptor_download_model` as `hf_token`.

The token is passed to the one download subprocess through `HF_TOKEN`; the helper does not log it, place it in process arguments, or persist it. The successful download records only local model/config paths, so later `muscriptor_start` calls work from the local cache without the token. `small` is the default and the practical CPU option.

HTTP endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /file?path=...` | Serve a local file |
| `POST /upload?path=...` | Upload/write a local file |
| `GET /project-root` | Return default project root |
| `GET /api/ai-tools` | AI bridge status |
| `POST /api/ai-tools` | Forward an AI tool call to the connected editor session |

MatAnyone2 is GPU-only: setup and server start require an accessible NVIDIA CUDA GPU. The helper and Python sidecar reject CPU execution.

Example:

```bash
curl -X POST http://127.0.0.1:9877/api/ai-tools \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <startup-token>" \
  -d '{"tool":"_status","args":{}}'
```

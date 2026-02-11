# MasterSelects Native Helper

Cross-platform video codec helper providing hardware-accelerated video decoding/encoding and video downloads for the MasterSelects web application.

## Features

- **Video Decoding**: FFmpeg-based decoding of H.264, ProRes, DNxHD, and more
- **Video Encoding**: ProRes, DNxHD, H.264, H.265, VP9, FFV1, UTVideo, MJPEG
- **Frame Cache**: LRU cache for decoded frames with configurable size
- **Video Downloads**: yt-dlp integration for YouTube, TikTok, Instagram, Twitter, etc.
- **WebSocket Protocol**: Binary frame transfer with LZ4 compression
- **HTTP File Server**: Direct file serving with CORS support

## Prerequisites

### All Platforms
- [Rust](https://rustup.rs/) (stable)
- [LLVM/Clang](https://releases.llvm.org/) (for bindgen during compilation)

### Windows

1. **FFmpeg 7.1 shared libraries** (required for compilation and runtime):
   - Download from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds/releases)
   - Look for: `ffmpeg-n7.1*-win64-gpl-shared-7.1.zip`
   - Extract to: `tools/native-helper/ffmpeg/win64/`
   - Expected structure: `ffmpeg/win64/{bin,include,lib}/`

2. **LLVM/Clang**: `winget install LLVM.LLVM`

### Linux
```bash
sudo apt install libavcodec-dev libavformat-dev libswscale-dev libavutil-dev clang pkg-config
```

### macOS
```bash
brew install ffmpeg llvm pkg-config
```

## Building

### Windows
```bash
set FFMPEG_DIR=path\to\tools\native-helper\ffmpeg\win64
set LIBCLANG_PATH=C:\Program Files\LLVM\lib
cargo build --release

# Copy DLLs next to binary for runtime
copy ffmpeg\win64\bin\*.dll target\release\
copy ffmpeg\win64\bin\ffmpeg.exe target\release\
```

### Linux / macOS
```bash
cargo build --release
```

## Running

```bash
./target/release/masterselects-helper          # Default: WS on :9876, HTTP on :9877
./target/release/masterselects-helper --port 9876 --cache-mb 4096
./target/release/masterselects-helper --background
```

## Protocol

WebSocket (JSON commands + binary frames) on port 9876, HTTP file server on port 9877.

| Command | Description |
|---------|-------------|
| `ping` | Connection keepalive |
| `info` | System info (FFmpeg version, HW accel, cache stats) |
| `open` | Open a video file for decoding |
| `decode` | Decode a specific frame (returns binary) |
| `close` | Close an open file |
| `start_encode` | Start an FFmpeg encode job |
| `encode_frame` | Send a frame for encoding (binary follows) |
| `finish_encode` | Finalize encoding |
| `list_formats` | List available download formats for a URL |
| `download` | Download a video with progress streaming |
| `get_file` | Get a file as base64 |

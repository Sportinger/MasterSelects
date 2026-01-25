# FFmpeg WASM Implementation Code Plan

## Overview

Implement a custom FFmpeg WASM build with professional codec support (HAP, ProRes, DNxHR, etc.) for browser-based video export in MASterSelects.

---

## File Structure

```
src/
├── engine/
│   └── ffmpeg/
│       ├── index.ts                    # Public exports
│       ├── FFmpegBridge.ts             # Main bridge class
│       ├── FFmpegWorker.ts             # Web Worker wrapper
│       ├── codecs.ts                   # Codec definitions & presets
│       ├── ImageSequenceExporter.ts    # Image sequence export
│       └── types.ts                    # TypeScript types
│
├── components/
│   └── export/
│       ├── ExportPanel.tsx             # Update with new codecs
│       ├── FFmpegExportSection.tsx     # NEW: FFmpeg-specific UI
│       ├── CodecSelector.tsx           # NEW: Codec picker component
│       ├── ImageSequenceDialog.tsx     # NEW: Image seq settings
│       └── ExportPresets.tsx           # NEW: Platform presets
│
ffmpeg-wasm/
├── Dockerfile                          # Build environment
├── Makefile                            # Build commands
├── scripts/
│   ├── build-libs.sh                   # Build external libraries
│   ├── build-ffmpeg.sh                 # Build FFmpeg
│   ├── build-wasm.sh                   # Create WASM module
│   └── test-codecs.sh                  # Test all codecs
├── patches/                            # Source patches if needed
└── dist/
    ├── ffmpeg-core.wasm                # Main WASM binary (~20MB)
    ├── ffmpeg-core.js                  # JS loader
    └── ffmpeg-core.worker.js           # Worker script
```

---

## Phase 1: Build Infrastructure

### 1.1 Create ffmpeg-wasm/Makefile

```makefile
# ffmpeg-wasm/Makefile

.PHONY: all build-docker build clean test

DOCKER_IMAGE = ffmpeg-wasm-builder
DIST_DIR = dist

all: build

build-docker:
	docker build -t $(DOCKER_IMAGE) .

build: build-docker
	docker run --rm -v $(PWD)/dist:/output $(DOCKER_IMAGE) \
		cp -r /src/dist/* /output/

clean:
	rm -rf $(DIST_DIR)/*

test:
	node test/test-codecs.js
```

### 1.2 Create ffmpeg-wasm/Dockerfile

```dockerfile
# ffmpeg-wasm/Dockerfile
FROM emscripten/emsdk:3.1.50

RUN apt-get update && apt-get install -y \
    autoconf automake libtool pkg-config \
    cmake ninja-build nasm yasm git wget texinfo \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Copy build scripts
COPY scripts/ /src/scripts/
RUN chmod +x /src/scripts/*.sh

# Build all libraries
RUN /src/scripts/build-libs.sh

# Build FFmpeg
RUN /src/scripts/build-ffmpeg.sh

# Create WASM module
RUN /src/scripts/build-wasm.sh

# Output directory
RUN mkdir -p /src/dist
```

### 1.3 Create ffmpeg-wasm/scripts/build-libs.sh

```bash
#!/bin/bash
set -e

NPROC=$(nproc)
PREFIX=/opt

echo "=== Building Snappy (for HAP) ==="
git clone --depth 1 https://github.com/google/snappy.git
cd /src/snappy && mkdir build && cd build
emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=$PREFIX/snappy \
    -DSNAPPY_BUILD_TESTS=OFF \
    -DSNAPPY_BUILD_BENCHMARKS=OFF
emmake make -j$NPROC && emmake make install
cd /src

echo "=== Building x264 ==="
git clone --depth 1 https://code.videolan.org/videolan/x264.git
cd /src/x264
emconfigure ./configure \
    --prefix=$PREFIX/x264 \
    --host=i686-gnu \
    --enable-static \
    --disable-cli \
    --disable-asm \
    --extra-cflags="-O3"
emmake make -j$NPROC && emmake make install
cd /src

echo "=== Building x265 ==="
git clone --depth 1 -b Release_3.5 https://bitbucket.org/multicoreware/x265_git.git
cd /src/x265_git/build/linux
emcmake cmake ../../source \
    -DCMAKE_INSTALL_PREFIX=$PREFIX/x265 \
    -DENABLE_SHARED=OFF \
    -DENABLE_CLI=OFF \
    -DENABLE_ASSEMBLY=OFF \
    -DHIGH_BIT_DEPTH=OFF
emmake make -j$NPROC && emmake make install
cd /src

echo "=== Building libvpx ==="
git clone --depth 1 https://chromium.googlesource.com/webm/libvpx.git
cd /src/libvpx
emconfigure ./configure \
    --prefix=$PREFIX/vpx \
    --target=generic-gnu \
    --enable-static \
    --disable-shared \
    --disable-examples \
    --disable-tools \
    --disable-docs \
    --disable-unit-tests \
    --enable-vp9-encoder \
    --enable-vp9-decoder
emmake make -j$NPROC && emmake make install
cd /src

echo "=== Building SVT-AV1 ==="
git clone --depth 1 https://gitlab.com/AOMediaCodec/SVT-AV1.git
cd /src/SVT-AV1 && mkdir build && cd build
emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=$PREFIX/svtav1 \
    -DBUILD_SHARED_LIBS=OFF \
    -DBUILD_TESTING=OFF \
    -DBUILD_APPS=OFF \
    -DCOMPILE_C_ONLY=ON
emmake make -j$NPROC && emmake make install
cd /src

echo "=== Building LAME (MP3) ==="
wget -q https://sourceforge.net/projects/lame/files/lame/3.100/lame-3.100.tar.gz
tar xf lame-3.100.tar.gz
cd /src/lame-3.100
emconfigure ./configure \
    --prefix=$PREFIX/lame \
    --host=i686-gnu \
    --enable-static \
    --disable-shared \
    --disable-frontend
emmake make -j$NPROC && emmake make install
cd /src

echo "=== Building Opus ==="
git clone --depth 1 https://github.com/xiph/opus.git
cd /src/opus && ./autogen.sh
emconfigure ./configure \
    --prefix=$PREFIX/opus \
    --host=i686-gnu \
    --enable-static \
    --disable-shared \
    --disable-doc \
    --disable-extra-programs
emmake make -j$NPROC && emmake make install
cd /src

echo "=== Building libwebp ==="
git clone --depth 1 https://chromium.googlesource.com/webm/libwebp
cd /src/libwebp && ./autogen.sh
emconfigure ./configure \
    --prefix=$PREFIX/webp \
    --host=i686-gnu \
    --enable-static \
    --disable-shared
emmake make -j$NPROC && emmake make install
cd /src

echo "=== Building OpenEXR ==="
git clone --depth 1 --branch v3.2.1 https://github.com/AcademySoftwareFoundation/openexr.git
cd /src/openexr && mkdir build && cd build
emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=$PREFIX/openexr \
    -DBUILD_SHARED_LIBS=OFF \
    -DOPENEXR_BUILD_TOOLS=OFF \
    -DOPENEXR_INSTALL_EXAMPLES=OFF \
    -DOPENEXR_BUILD_PYTHON=OFF
emmake make -j$NPROC && emmake make install
cd /src

echo "=== All libraries built successfully ==="
```

### 1.4 Create ffmpeg-wasm/scripts/build-ffmpeg.sh

```bash
#!/bin/bash
set -e

NPROC=$(nproc)
PREFIX=/opt

echo "=== Cloning FFmpeg ==="
git clone --depth 1 -b n6.1 https://github.com/FFmpeg/FFmpeg.git /src/ffmpeg
cd /src/ffmpeg

echo "=== Configuring FFmpeg ==="
PKG_CONFIG_PATH="$PREFIX/x264/lib/pkgconfig:$PREFIX/x265/lib/pkgconfig:$PREFIX/vpx/lib/pkgconfig:$PREFIX/svtav1/lib/pkgconfig:$PREFIX/opus/lib/pkgconfig"

emconfigure ./configure \
    --prefix=$PREFIX/ffmpeg \
    --target-os=none \
    --arch=x86_32 \
    --enable-cross-compile \
    --disable-x86asm \
    --disable-inline-asm \
    --disable-stripping \
    --disable-programs \
    --disable-doc \
    --disable-debug \
    --disable-runtime-cpudetect \
    --disable-autodetect \
    --disable-pthreads \
    \
    --enable-gpl \
    --enable-version3 \
    \
    --enable-libx264 \
    --enable-libx265 \
    --enable-libvpx \
    --enable-libsvtav1 \
    --enable-libsnappy \
    --enable-libmp3lame \
    --enable-libopus \
    --enable-libwebp \
    \
    --enable-encoder=libx264 \
    --enable-encoder=libx265 \
    --enable-encoder=libvpx_vp9 \
    --enable-encoder=libsvtav1 \
    --enable-encoder=prores_ks \
    --enable-encoder=hap \
    --enable-encoder=dnxhd \
    --enable-encoder=ffv1 \
    --enable-encoder=utvideo \
    --enable-encoder=mjpeg \
    --enable-encoder=png \
    --enable-encoder=tiff \
    --enable-encoder=dpx \
    --enable-encoder=libwebp \
    --enable-encoder=aac \
    --enable-encoder=libmp3lame \
    --enable-encoder=libopus \
    --enable-encoder=flac \
    --enable-encoder=alac \
    --enable-encoder=pcm_s16le \
    --enable-encoder=pcm_s24le \
    --enable-encoder=ac3 \
    \
    --enable-decoder=h264 \
    --enable-decoder=hevc \
    --enable-decoder=vp9 \
    --enable-decoder=av1 \
    --enable-decoder=prores \
    --enable-decoder=hap \
    --enable-decoder=dnxhd \
    --enable-decoder=png \
    --enable-decoder=mjpeg \
    --enable-decoder=pcm_s16le \
    --enable-decoder=aac \
    \
    --enable-muxer=mov \
    --enable-muxer=mp4 \
    --enable-muxer=matroska \
    --enable-muxer=webm \
    --enable-muxer=avi \
    --enable-muxer=mxf \
    --enable-muxer=mxf_opatom \
    --enable-muxer=mpegts \
    --enable-muxer=ogg \
    --enable-muxer=wav \
    --enable-muxer=image2 \
    \
    --enable-demuxer=mov \
    --enable-demuxer=matroska \
    --enable-demuxer=avi \
    --enable-demuxer=image2 \
    --enable-demuxer=wav \
    \
    --enable-parser=h264 \
    --enable-parser=hevc \
    \
    --enable-filter=scale \
    --enable-filter=fps \
    --enable-filter=colorspace \
    --enable-filter=format \
    --enable-filter=aformat \
    --enable-filter=aresample \
    --enable-filter=loudnorm \
    --enable-filter=volume \
    --enable-filter=null \
    --enable-filter=anull \
    \
    --enable-protocol=file \
    \
    --extra-cflags="-O3 -I$PREFIX/x264/include -I$PREFIX/x265/include -I$PREFIX/vpx/include -I$PREFIX/svtav1/include -I$PREFIX/snappy/include -I$PREFIX/lame/include -I$PREFIX/opus/include -I$PREFIX/webp/include" \
    --extra-ldflags="-L$PREFIX/x264/lib -L$PREFIX/x265/lib -L$PREFIX/vpx/lib -L$PREFIX/svtav1/lib -L$PREFIX/snappy/lib -L$PREFIX/lame/lib -L$PREFIX/opus/lib -L$PREFIX/webp/lib" \
    --pkg-config-flags="--static" \
    --nm="llvm-nm" \
    --ar="emar" \
    --ranlib="emranlib" \
    --cc="emcc" \
    --cxx="em++" \
    --objcc="emcc" \
    --dep-cc="emcc"

echo "=== Building FFmpeg ==="
emmake make -j$NPROC

echo "=== FFmpeg built successfully ==="
```

### 1.5 Create ffmpeg-wasm/scripts/build-wasm.sh

```bash
#!/bin/bash
set -e

PREFIX=/opt
DIST=/src/dist
mkdir -p $DIST

cd /src/ffmpeg

echo "=== Creating WASM module ==="

# Collect all static libraries
LIBS="-lavcodec -lavformat -lavutil -lswscale -lavfilter -lswresample"
LIBS="$LIBS -L$PREFIX/x264/lib -lx264"
LIBS="$LIBS -L$PREFIX/x265/lib -lx265"
LIBS="$LIBS -L$PREFIX/vpx/lib -lvpx"
LIBS="$LIBS -L$PREFIX/svtav1/lib -lSvtAv1Enc"
LIBS="$LIBS -L$PREFIX/snappy/lib -lsnappy"
LIBS="$LIBS -L$PREFIX/lame/lib -lmp3lame"
LIBS="$LIBS -L$PREFIX/opus/lib -lopus"
LIBS="$LIBS -L$PREFIX/webp/lib -lwebp -lsharpyuv"

emcc \
    -O3 \
    -I. \
    -Llibavcodec -Llibavformat -Llibavutil -Llibswscale -Llibavfilter -Llibswresample \
    fftools/ffmpeg.c \
    fftools/ffmpeg_opt.c \
    fftools/ffmpeg_filter.c \
    fftools/ffmpeg_hw.c \
    fftools/ffmpeg_mux.c \
    fftools/ffmpeg_mux_init.c \
    fftools/ffmpeg_demux.c \
    fftools/ffmpeg_enc.c \
    fftools/ffmpeg_dec.c \
    fftools/cmdutils.c \
    fftools/objpool.c \
    fftools/sync_queue.c \
    fftools/thread_queue.c \
    fftools/opt_common.c \
    $LIBS \
    -o $DIST/ffmpeg-core.js \
    -s WASM=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME="createFFmpegCore" \
    -s EXPORTED_FUNCTIONS="['_main', '_malloc', '_free']" \
    -s EXPORTED_RUNTIME_METHODS="['FS', 'callMain', 'cwrap', 'ccall', 'setValue', 'getValue']" \
    -s INITIAL_MEMORY=268435456 \
    -s MAXIMUM_MEMORY=2147483648 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INVOKE_RUN=0 \
    -s EXIT_RUNTIME=0 \
    -s FILESYSTEM=1 \
    -s FORCE_FILESYSTEM=1 \
    -s ENVIRONMENT='web,worker' \
    -s SINGLE_FILE=0 \
    -s ASSERTIONS=0 \
    -lworkerfs.js

echo "=== WASM module created ==="
ls -lh $DIST/

echo "=== Compressing ==="
gzip -k $DIST/ffmpeg-core.wasm
ls -lh $DIST/
```

---

## Phase 2: TypeScript Integration

### 2.1 Create src/engine/ffmpeg/types.ts

```typescript
// src/engine/ffmpeg/types.ts

// Video codec types
export type ProResProfile = 'proxy' | 'lt' | 'standard' | 'hq' | '4444' | '4444xq';
export type HapFormat = 'hap' | 'hap_alpha' | 'hap_q';
export type DnxhrProfile = 'dnxhr_lb' | 'dnxhr_sq' | 'dnxhr_hq' | 'dnxhr_hqx' | 'dnxhr_444';

export type FFmpegVideoCodec =
  | 'prores'
  | 'hap'
  | 'dnxhd'
  | 'ffv1'
  | 'utvideo'
  | 'mjpeg'
  | 'libx264'
  | 'libx265'
  | 'libvpx_vp9'
  | 'libsvtav1';

export type FFmpegAudioCodec =
  | 'aac'
  | 'libmp3lame'
  | 'libopus'
  | 'flac'
  | 'alac'
  | 'pcm_s16le'
  | 'pcm_s24le'
  | 'ac3'
  | 'none';

export type FFmpegContainer =
  | 'mov'
  | 'mp4'
  | 'mkv'
  | 'webm'
  | 'avi'
  | 'mxf';

export type FFmpegImageFormat =
  | 'png'
  | 'jpeg'
  | 'tiff'
  | 'exr'
  | 'dpx'
  | 'webp'
  | 'tga';

export type PixelFormat =
  | 'yuv420p'
  | 'yuv422p'
  | 'yuv444p'
  | 'yuv420p10le'
  | 'yuv422p10le'
  | 'yuv444p10le'
  | 'yuva444p10le'
  | 'rgba'
  | 'rgb48le'
  | 'gbrp10le'
  | 'gbrpf32le';

export type ColorSpace = 'bt709' | 'bt2020' | 'srgb';

export interface FFmpegExportSettings {
  // Video
  codec: FFmpegVideoCodec;
  container: FFmpegContainer;
  width: number;
  height: number;
  fps: number;

  // Quality
  bitrate?: number;
  quality?: number;  // CRF (0-51)

  // Pixel format
  pixelFormat?: PixelFormat;
  colorSpace?: ColorSpace;

  // Codec-specific
  proresProfile?: ProResProfile;
  hapFormat?: HapFormat;
  hapChunks?: number;
  hapCompressor?: 'snappy' | 'none';
  dnxhrProfile?: DnxhrProfile;

  // Audio
  audioCodec?: FFmpegAudioCodec;
  audioSampleRate?: 44100 | 48000;
  audioBitrate?: number;
  audioChannels?: 1 | 2 | 6;

  // Range
  startTime: number;
  endTime: number;
}

export interface ImageSequenceSettings {
  format: FFmpegImageFormat;
  width: number;
  height: number;
  fps: number;
  startFrame: number;
  endFrame: number;
  padding: number;
  filenamePattern: string;

  // Format-specific
  jpegQuality?: number;
  pngCompression?: number;
  exrCompression?: 'none' | 'piz' | 'zip' | 'zips' | 'rle' | 'pxr24' | 'b44' | 'dwaa' | 'dwab';
  bitDepth?: 8 | 16 | 32;
}

export interface FFmpegProgress {
  frame: number;
  fps: number;
  time: number;
  speed: number;
  bitrate: number;
  size: number;
  percent: number;
  eta: number;
}

export interface FFmpegLogEntry {
  type: 'info' | 'warning' | 'error';
  message: string;
  timestamp: number;
}

export interface CodecInfo {
  id: string;
  name: string;
  description: string;
  category: 'professional' | 'realtime' | 'lossless' | 'delivery';
  containers: FFmpegContainer[];
  supportsAlpha: boolean;
  supports10bit: boolean;
  defaultPixelFormat: PixelFormat;
}
```

### 2.2 Create src/engine/ffmpeg/codecs.ts

```typescript
// src/engine/ffmpeg/codecs.ts

import type { CodecInfo, FFmpegContainer } from './types';

export const FFMPEG_CODECS: CodecInfo[] = [
  // Professional
  {
    id: 'prores',
    name: 'Apple ProRes',
    description: 'Industry standard intermediate codec',
    category: 'professional',
    containers: ['mov'],
    supportsAlpha: true,
    supports10bit: true,
    defaultPixelFormat: 'yuv422p10le',
  },
  {
    id: 'dnxhd',
    name: 'Avid DNxHR',
    description: 'Broadcast/Avid workflows',
    category: 'professional',
    containers: ['mxf', 'mov'],
    supportsAlpha: false,
    supports10bit: true,
    defaultPixelFormat: 'yuv422p',
  },

  // Real-time
  {
    id: 'hap',
    name: 'HAP',
    description: 'GPU-accelerated VJ codec',
    category: 'realtime',
    containers: ['mov', 'avi'],
    supportsAlpha: true,
    supports10bit: false,
    defaultPixelFormat: 'rgba',
  },

  // Lossless
  {
    id: 'ffv1',
    name: 'FFV1',
    description: 'Lossless archival codec',
    category: 'lossless',
    containers: ['mkv', 'avi'],
    supportsAlpha: true,
    supports10bit: true,
    defaultPixelFormat: 'yuv444p10le',
  },
  {
    id: 'utvideo',
    name: 'Ut Video',
    description: 'Fast lossless codec',
    category: 'lossless',
    containers: ['avi', 'mkv'],
    supportsAlpha: true,
    supports10bit: false,
    defaultPixelFormat: 'rgba',
  },

  // Delivery
  {
    id: 'libx264',
    name: 'H.264 (x264)',
    description: 'Universal delivery codec',
    category: 'delivery',
    containers: ['mp4', 'mkv', 'mov'],
    supportsAlpha: false,
    supports10bit: true,
    defaultPixelFormat: 'yuv420p',
  },
  {
    id: 'libx265',
    name: 'H.265/HEVC (x265)',
    description: 'High efficiency, HDR support',
    category: 'delivery',
    containers: ['mp4', 'mkv', 'mov'],
    supportsAlpha: false,
    supports10bit: true,
    defaultPixelFormat: 'yuv420p',
  },
  {
    id: 'libvpx_vp9',
    name: 'VP9',
    description: 'Open web codec',
    category: 'delivery',
    containers: ['webm', 'mkv'],
    supportsAlpha: true,
    supports10bit: true,
    defaultPixelFormat: 'yuv420p',
  },
  {
    id: 'libsvtav1',
    name: 'AV1 (SVT)',
    description: 'Next-gen open codec',
    category: 'delivery',
    containers: ['mp4', 'mkv', 'webm'],
    supportsAlpha: false,
    supports10bit: true,
    defaultPixelFormat: 'yuv420p',
  },
];

export const PRORES_PROFILES = [
  { id: 'proxy', name: 'ProRes Proxy', profile: 0, bitrate: 45 },
  { id: 'lt', name: 'ProRes LT', profile: 1, bitrate: 102 },
  { id: 'standard', name: 'ProRes 422', profile: 2, bitrate: 147 },
  { id: 'hq', name: 'ProRes 422 HQ', profile: 3, bitrate: 220 },
  { id: '4444', name: 'ProRes 4444', profile: 4, bitrate: 330 },
  { id: '4444xq', name: 'ProRes 4444 XQ', profile: 5, bitrate: 500 },
];

export const DNXHR_PROFILES = [
  { id: 'dnxhr_lb', name: 'DNxHR LB', description: 'Low Bandwidth' },
  { id: 'dnxhr_sq', name: 'DNxHR SQ', description: 'Standard Quality' },
  { id: 'dnxhr_hq', name: 'DNxHR HQ', description: 'High Quality' },
  { id: 'dnxhr_hqx', name: 'DNxHR HQX', description: '10-bit High Quality' },
  { id: 'dnxhr_444', name: 'DNxHR 444', description: '10-bit 4:4:4' },
];

export const HAP_FORMATS = [
  { id: 'hap', name: 'HAP', description: 'Good quality, smallest size' },
  { id: 'hap_alpha', name: 'HAP Alpha', description: 'With alpha channel' },
  { id: 'hap_q', name: 'HAP Q', description: 'Higher quality, larger size' },
];

export const PLATFORM_PRESETS = {
  youtube: {
    name: 'YouTube',
    codec: 'libx264',
    container: 'mp4',
    pixelFormat: 'yuv420p',
    quality: 18,
    audioCodec: 'aac',
    audioBitrate: 256000,
  },
  vimeo: {
    name: 'Vimeo',
    codec: 'libx264',
    container: 'mp4',
    pixelFormat: 'yuv420p',
    quality: 16,
    audioCodec: 'aac',
    audioBitrate: 320000,
  },
  instagram: {
    name: 'Instagram',
    codec: 'libx264',
    container: 'mp4',
    pixelFormat: 'yuv420p',
    bitrate: 3500000,
    audioCodec: 'aac',
    audioBitrate: 128000,
  },
  tiktok: {
    name: 'TikTok',
    codec: 'libx264',
    container: 'mp4',
    pixelFormat: 'yuv420p',
    bitrate: 2500000,
    audioCodec: 'aac',
    audioBitrate: 128000,
  },
  twitter: {
    name: 'Twitter/X',
    codec: 'libx264',
    container: 'mp4',
    pixelFormat: 'yuv420p',
    bitrate: 5000000,
    audioCodec: 'aac',
    audioBitrate: 128000,
  },
  archive: {
    name: 'Archive (Lossless)',
    codec: 'ffv1',
    container: 'mkv',
    pixelFormat: 'yuv444p10le',
    audioCodec: 'flac',
  },
  vj: {
    name: 'VJ / Media Server',
    codec: 'hap',
    container: 'mov',
    hapFormat: 'hap_q',
    hapChunks: 4,
    audioCodec: 'none',
  },
  premiere: {
    name: 'Adobe Premiere',
    codec: 'prores',
    container: 'mov',
    proresProfile: 'hq',
    audioCodec: 'pcm_s24le',
  },
  davinci: {
    name: 'DaVinci Resolve',
    codec: 'dnxhd',
    container: 'mxf',
    dnxhrProfile: 'dnxhr_hq',
    audioCodec: 'pcm_s24le',
  },
} as const;

export function getCodecInfo(codecId: string): CodecInfo | undefined {
  return FFMPEG_CODECS.find(c => c.id === codecId);
}

export function getCodecsForContainer(container: FFmpegContainer): CodecInfo[] {
  return FFMPEG_CODECS.filter(c => c.containers.includes(container));
}

export function getContainersForCodec(codecId: string): FFmpegContainer[] {
  const codec = getCodecInfo(codecId);
  return codec?.containers || [];
}
```

### 2.3 Create src/engine/ffmpeg/FFmpegBridge.ts

```typescript
// src/engine/ffmpeg/FFmpegBridge.ts

import type {
  FFmpegExportSettings,
  ImageSequenceSettings,
  FFmpegProgress,
  FFmpegLogEntry,
  ProResProfile,
  HapFormat,
  DnxhrProfile,
} from './types';
import { PRORES_PROFILES } from './codecs';

type FFmpegCore = {
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    unlink: (path: string) => void;
    readdir: (path: string) => string[];
    mkdir: (path: string) => void;
  };
  callMain: (args: string[]) => number;
};

export class FFmpegBridge {
  private core: FFmpegCore | null = null;
  private loading: Promise<void> | null = null;
  private logs: FFmpegLogEntry[] = [];
  private onProgress?: (progress: FFmpegProgress) => void;
  private onLog?: (log: FFmpegLogEntry) => void;
  private cancelled = false;

  async load(): Promise<void> {
    if (this.core) return;
    if (this.loading) return this.loading;

    this.loading = this.doLoad();
    await this.loading;
  }

  private async doLoad(): Promise<void> {
    console.log('[FFmpegBridge] Loading WASM module...');
    const startTime = performance.now();

    try {
      // Dynamic import - only loads when needed
      const { default: createFFmpegCore } = await import(
        /* webpackChunkName: "ffmpeg-core" */
        '../../../ffmpeg-wasm/dist/ffmpeg-core.js'
      );

      this.core = await createFFmpegCore({
        print: (msg: string) => this.handleLog('info', msg),
        printErr: (msg: string) => this.handleLog('error', msg),
      });

      const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);
      console.log(`[FFmpegBridge] Loaded in ${loadTime}s`);
    } catch (error) {
      console.error('[FFmpegBridge] Failed to load:', error);
      throw error;
    }
  }

  isLoaded(): boolean {
    return this.core !== null;
  }

  private handleLog(type: 'info' | 'warning' | 'error', message: string): void {
    const entry: FFmpegLogEntry = {
      type,
      message,
      timestamp: Date.now(),
    };
    this.logs.push(entry);
    this.onLog?.(entry);

    // Parse progress from FFmpeg output
    const progress = this.parseProgress(message);
    if (progress) {
      this.onProgress?.(progress);
    }
  }

  private parseProgress(message: string): FFmpegProgress | null {
    // FFmpeg progress format: frame=  123 fps= 30 q=28.0 size=    1234kB time=00:00:04.10 bitrate= 2469.5kbits/s speed=1.00x
    const frameMatch = message.match(/frame=\s*(\d+)/);
    const fpsMatch = message.match(/fps=\s*([\d.]+)/);
    const timeMatch = message.match(/time=(\d+):(\d+):([\d.]+)/);
    const speedMatch = message.match(/speed=\s*([\d.]+)x/);
    const bitrateMatch = message.match(/bitrate=\s*([\d.]+)kbits/);
    const sizeMatch = message.match(/size=\s*(\d+)kB/);

    if (frameMatch && timeMatch) {
      const hours = parseInt(timeMatch[1]);
      const minutes = parseInt(timeMatch[2]);
      const seconds = parseFloat(timeMatch[3]);
      const time = hours * 3600 + minutes * 60 + seconds;

      return {
        frame: parseInt(frameMatch[1]),
        fps: fpsMatch ? parseFloat(fpsMatch[1]) : 0,
        time,
        speed: speedMatch ? parseFloat(speedMatch[1]) : 0,
        bitrate: bitrateMatch ? parseFloat(bitrateMatch[1]) * 1000 : 0,
        size: sizeMatch ? parseInt(sizeMatch[1]) * 1024 : 0,
        percent: 0, // Calculated by caller based on duration
        eta: 0,
      };
    }

    return null;
  }

  async encode(
    frames: Uint8Array[],
    settings: FFmpegExportSettings,
    onProgress?: (progress: FFmpegProgress) => void
  ): Promise<Blob> {
    if (!this.core) await this.load();
    if (!this.core) throw new Error('FFmpeg not loaded');

    this.cancelled = false;
    this.onProgress = onProgress;
    this.logs = [];

    const fs = this.core.FS;

    try {
      // Create input directory
      try { fs.mkdir('/input'); } catch {}
      try { fs.mkdir('/output'); } catch {}

      // Write frames to virtual filesystem
      console.log(`[FFmpegBridge] Writing ${frames.length} frames...`);
      for (let i = 0; i < frames.length; i++) {
        if (this.cancelled) throw new Error('Cancelled');
        const filename = `/input/frame_${String(i).padStart(6, '0')}.raw`;
        fs.writeFile(filename, frames[i]);
      }

      // Build and run FFmpeg command
      const args = this.buildArgs(settings, frames.length);
      console.log('[FFmpegBridge] Running:', 'ffmpeg', args.join(' '));

      const exitCode = this.core.callMain(args);
      if (exitCode !== 0) {
        throw new Error(`FFmpeg exited with code ${exitCode}`);
      }

      // Read output file
      const outputPath = `/output/output.${settings.container}`;
      const data = fs.readFile(outputPath);

      return new Blob([data], { type: this.getMimeType(settings.container) });
    } finally {
      this.cleanup();
    }
  }

  private buildArgs(settings: FFmpegExportSettings, frameCount: number): string[] {
    const args: string[] = [
      '-y',                            // Overwrite
      '-f', 'rawvideo',                // Input format
      '-pix_fmt', 'rgba',              // Input pixel format (from canvas)
      '-s', `${settings.width}x${settings.height}`,
      '-r', String(settings.fps),
      '-i', '/input/frame_%06d.raw',   // Input pattern
    ];

    // Video codec
    args.push(...this.buildVideoArgs(settings));

    // Audio
    if (settings.audioCodec && settings.audioCodec !== 'none') {
      // TODO: Handle audio input
      args.push('-an'); // No audio for now
    } else {
      args.push('-an');
    }

    // Output
    args.push(`/output/output.${settings.container}`);

    return args;
  }

  private buildVideoArgs(settings: FFmpegExportSettings): string[] {
    const args: string[] = [];

    switch (settings.codec) {
      case 'prores':
        args.push('-c:v', 'prores_ks');
        args.push('-profile:v', this.getProResProfileNumber(settings.proresProfile || 'hq'));
        args.push('-pix_fmt', settings.proresProfile?.includes('4444') ? 'yuva444p10le' : 'yuv422p10le');
        args.push('-vendor', 'apl0');
        break;

      case 'hap':
        args.push('-c:v', 'hap');
        args.push('-format', settings.hapFormat || 'hap');
        args.push('-compressor', settings.hapCompressor || 'snappy');
        args.push('-chunks', String(settings.hapChunks || 4));
        break;

      case 'dnxhd':
        args.push('-c:v', 'dnxhd');
        args.push('-profile:v', settings.dnxhrProfile || 'dnxhr_hq');
        if (settings.dnxhrProfile === 'dnxhr_444') {
          args.push('-pix_fmt', 'yuv444p10le');
        } else if (settings.dnxhrProfile === 'dnxhr_hqx') {
          args.push('-pix_fmt', 'yuv422p10le');
        } else {
          args.push('-pix_fmt', 'yuv422p');
        }
        break;

      case 'ffv1':
        args.push('-c:v', 'ffv1');
        args.push('-level', '3');
        args.push('-coder', '1');
        args.push('-context', '1');
        args.push('-slicecrc', '1');
        args.push('-pix_fmt', settings.pixelFormat || 'yuv444p10le');
        break;

      case 'libx264':
        args.push('-c:v', 'libx264');
        args.push('-preset', 'medium');
        args.push('-pix_fmt', settings.pixelFormat || 'yuv420p');
        if (settings.quality !== undefined) {
          args.push('-crf', String(settings.quality));
        } else if (settings.bitrate) {
          args.push('-b:v', String(settings.bitrate));
        } else {
          args.push('-crf', '18');
        }
        break;

      case 'libx265':
        args.push('-c:v', 'libx265');
        args.push('-preset', 'medium');
        args.push('-pix_fmt', settings.pixelFormat || 'yuv420p');
        if (settings.quality !== undefined) {
          args.push('-crf', String(settings.quality));
        } else {
          args.push('-crf', '22');
        }
        break;

      case 'libvpx_vp9':
        args.push('-c:v', 'libvpx-vp9');
        args.push('-pix_fmt', settings.pixelFormat || 'yuv420p');
        if (settings.quality !== undefined) {
          args.push('-crf', String(settings.quality));
          args.push('-b:v', '0');
        } else if (settings.bitrate) {
          args.push('-b:v', String(settings.bitrate));
        }
        break;

      case 'libsvtav1':
        args.push('-c:v', 'libsvtav1');
        args.push('-preset', '6');
        args.push('-pix_fmt', settings.pixelFormat || 'yuv420p');
        if (settings.quality !== undefined) {
          args.push('-crf', String(settings.quality));
        } else {
          args.push('-crf', '30');
        }
        break;

      default:
        args.push('-c:v', settings.codec);
    }

    return args;
  }

  private getProResProfileNumber(profile: ProResProfile): string {
    const profiles: Record<ProResProfile, string> = {
      proxy: '0',
      lt: '1',
      standard: '2',
      hq: '3',
      '4444': '4',
      '4444xq': '5',
    };
    return profiles[profile] || '3';
  }

  private getMimeType(container: string): string {
    const types: Record<string, string> = {
      mov: 'video/quicktime',
      mp4: 'video/mp4',
      mkv: 'video/x-matroska',
      webm: 'video/webm',
      avi: 'video/x-msvideo',
      mxf: 'application/mxf',
    };
    return types[container] || 'video/mp4';
  }

  private cleanup(): void {
    if (!this.core) return;
    const fs = this.core.FS;

    try {
      // Clean input files
      const inputFiles = fs.readdir('/input');
      for (const file of inputFiles) {
        if (file !== '.' && file !== '..') {
          fs.unlink(`/input/${file}`);
        }
      }

      // Clean output files
      const outputFiles = fs.readdir('/output');
      for (const file of outputFiles) {
        if (file !== '.' && file !== '..') {
          fs.unlink(`/output/${file}`);
        }
      }
    } catch (e) {
      console.warn('[FFmpegBridge] Cleanup error:', e);
    }
  }

  cancel(): void {
    this.cancelled = true;
  }

  getLogs(): FFmpegLogEntry[] {
    return [...this.logs];
  }
}

// Singleton instance
let instance: FFmpegBridge | null = null;

export function getFFmpegBridge(): FFmpegBridge {
  if (!instance) {
    instance = new FFmpegBridge();
  }
  return instance;
}
```

### 2.4 Create src/engine/ffmpeg/index.ts

```typescript
// src/engine/ffmpeg/index.ts

export { FFmpegBridge, getFFmpegBridge } from './FFmpegBridge';
export { FFMPEG_CODECS, PRORES_PROFILES, DNXHR_PROFILES, HAP_FORMATS, PLATFORM_PRESETS } from './codecs';
export { getCodecInfo, getCodecsForContainer, getContainersForCodec } from './codecs';
export type * from './types';
```

---

## Phase 3: UI Components

### 3.1 Create src/components/export/CodecSelector.tsx

```typescript
// src/components/export/CodecSelector.tsx

import { useMemo } from 'react';
import { FFMPEG_CODECS, getCodecsForContainer } from '../../engine/ffmpeg';
import type { FFmpegVideoCodec, FFmpegContainer, CodecInfo } from '../../engine/ffmpeg/types';

interface CodecSelectorProps {
  container: FFmpegContainer;
  value: FFmpegVideoCodec;
  onChange: (codec: FFmpegVideoCodec) => void;
  showCategory?: boolean;
}

export function CodecSelector({ container, value, onChange, showCategory = true }: CodecSelectorProps) {
  const availableCodecs = useMemo(() => getCodecsForContainer(container), [container]);

  const groupedCodecs = useMemo(() => {
    const groups: Record<string, CodecInfo[]> = {};
    for (const codec of availableCodecs) {
      const category = codec.category;
      if (!groups[category]) groups[category] = [];
      groups[category].push(codec);
    }
    return groups;
  }, [availableCodecs]);

  const categoryLabels: Record<string, string> = {
    professional: 'Professional',
    realtime: 'Real-time / VJ',
    lossless: 'Lossless',
    delivery: 'Delivery',
  };

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as FFmpegVideoCodec)}
      className="codec-selector"
    >
      {showCategory ? (
        Object.entries(groupedCodecs).map(([category, codecs]) => (
          <optgroup key={category} label={categoryLabels[category] || category}>
            {codecs.map((codec) => (
              <option key={codec.id} value={codec.id}>
                {codec.name}
              </option>
            ))}
          </optgroup>
        ))
      ) : (
        availableCodecs.map((codec) => (
          <option key={codec.id} value={codec.id}>
            {codec.name}
          </option>
        ))
      )}
    </select>
  );
}
```

### 3.2 Create src/components/export/FFmpegExportSection.tsx

```typescript
// src/components/export/FFmpegExportSection.tsx

import { useState, useEffect, useCallback } from 'react';
import { getFFmpegBridge, PRORES_PROFILES, DNXHR_PROFILES, HAP_FORMATS, PLATFORM_PRESETS } from '../../engine/ffmpeg';
import { CodecSelector } from './CodecSelector';
import type { FFmpegExportSettings, FFmpegProgress, FFmpegVideoCodec, FFmpegContainer } from '../../engine/ffmpeg/types';

interface FFmpegExportSectionProps {
  width: number;
  height: number;
  fps: number;
  startTime: number;
  endTime: number;
  onExport: (settings: FFmpegExportSettings) => Promise<Uint8Array[]>;
}

export function FFmpegExportSection({
  width,
  height,
  fps,
  startTime,
  endTime,
  onExport,
}: FFmpegExportSectionProps) {
  // FFmpeg loading state
  const [isLoading, setIsLoading] = useState(false);
  const [isFFmpegReady, setIsFFmpegReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);

  // Export settings
  const [codec, setCodec] = useState<FFmpegVideoCodec>('prores');
  const [container, setContainer] = useState<FFmpegContainer>('mov');
  const [preset, setPreset] = useState<string>('');

  // Codec-specific
  const [proresProfile, setProresProfile] = useState('hq');
  const [dnxhrProfile, setDnxhrProfile] = useState('dnxhr_hq');
  const [hapFormat, setHapFormat] = useState('hap_q');
  const [hapChunks, setHapChunks] = useState(4);

  // Quality
  const [useQuality, setUseQuality] = useState(true);
  const [quality, setQuality] = useState(18);
  const [bitrate, setBitrate] = useState(20000000);

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<FFmpegProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load FFmpeg on demand
  const loadFFmpeg = useCallback(async () => {
    setIsLoading(true);
    setLoadProgress(0);
    try {
      const ffmpeg = getFFmpegBridge();
      await ffmpeg.load();
      setIsFFmpegReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load FFmpeg');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Apply preset
  const applyPreset = useCallback((presetId: string) => {
    const presetConfig = PLATFORM_PRESETS[presetId as keyof typeof PLATFORM_PRESETS];
    if (!presetConfig) return;

    setCodec(presetConfig.codec as FFmpegVideoCodec);
    setContainer(presetConfig.container as FFmpegContainer);

    if ('quality' in presetConfig) setQuality(presetConfig.quality);
    if ('bitrate' in presetConfig) setBitrate(presetConfig.bitrate);
    if ('proresProfile' in presetConfig) setProresProfile(presetConfig.proresProfile);
    if ('dnxhrProfile' in presetConfig) setDnxhrProfile(presetConfig.dnxhrProfile);
    if ('hapFormat' in presetConfig) setHapFormat(presetConfig.hapFormat);

    setPreset(presetId);
  }, []);

  // Start export
  const handleExport = useCallback(async () => {
    if (!isFFmpegReady) {
      await loadFFmpeg();
    }

    setIsExporting(true);
    setError(null);
    setProgress(null);

    try {
      const settings: FFmpegExportSettings = {
        codec,
        container,
        width,
        height,
        fps,
        startTime,
        endTime,
        quality: useQuality ? quality : undefined,
        bitrate: !useQuality ? bitrate : undefined,
        proresProfile: codec === 'prores' ? proresProfile as any : undefined,
        dnxhrProfile: codec === 'dnxhd' ? dnxhrProfile as any : undefined,
        hapFormat: codec === 'hap' ? hapFormat as any : undefined,
        hapChunks: codec === 'hap' ? hapChunks : undefined,
      };

      // Get frames from parent
      const frames = await onExport(settings);

      // Encode with FFmpeg
      const ffmpeg = getFFmpegBridge();
      const blob = await ffmpeg.encode(frames, settings, (p) => {
        setProgress(p);
      });

      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `export.${container}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  }, [codec, container, width, height, fps, startTime, endTime, quality, bitrate, useQuality, proresProfile, dnxhrProfile, hapFormat, hapChunks, isFFmpegReady, loadFFmpeg, onExport]);

  return (
    <div className="ffmpeg-export-section">
      <div className="export-section-header">
        Professional Export (FFmpeg)
        {!isFFmpegReady && (
          <button onClick={loadFFmpeg} disabled={isLoading} className="btn-small">
            {isLoading ? 'Loading...' : 'Load FFmpeg (~20MB)'}
          </button>
        )}
      </div>

      {/* Presets */}
      <div className="control-row">
        <label>Preset</label>
        <select value={preset} onChange={(e) => applyPreset(e.target.value)}>
          <option value="">Custom</option>
          <optgroup label="Platforms">
            <option value="youtube">YouTube</option>
            <option value="vimeo">Vimeo</option>
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="twitter">Twitter/X</option>
          </optgroup>
          <optgroup label="Professional">
            <option value="premiere">Adobe Premiere</option>
            <option value="davinci">DaVinci Resolve</option>
            <option value="vj">VJ / Media Server</option>
            <option value="archive">Archive (Lossless)</option>
          </optgroup>
        </select>
      </div>

      {/* Container */}
      <div className="control-row">
        <label>Container</label>
        <select value={container} onChange={(e) => setContainer(e.target.value as FFmpegContainer)}>
          <option value="mov">MOV (QuickTime)</option>
          <option value="mp4">MP4</option>
          <option value="mkv">MKV (Matroska)</option>
          <option value="webm">WebM</option>
          <option value="avi">AVI</option>
          <option value="mxf">MXF (Broadcast)</option>
        </select>
      </div>

      {/* Codec */}
      <div className="control-row">
        <label>Codec</label>
        <CodecSelector container={container} value={codec} onChange={setCodec} />
      </div>

      {/* ProRes Profile */}
      {codec === 'prores' && (
        <div className="control-row">
          <label>Profile</label>
          <select value={proresProfile} onChange={(e) => setProresProfile(e.target.value)}>
            {PRORES_PROFILES.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* DNxHR Profile */}
      {codec === 'dnxhd' && (
        <div className="control-row">
          <label>Profile</label>
          <select value={dnxhrProfile} onChange={(e) => setDnxhrProfile(e.target.value)}>
            {DNXHR_PROFILES.map((p) => (
              <option key={p.id} value={p.id}>{p.name} - {p.description}</option>
            ))}
          </select>
        </div>
      )}

      {/* HAP Settings */}
      {codec === 'hap' && (
        <>
          <div className="control-row">
            <label>Format</label>
            <select value={hapFormat} onChange={(e) => setHapFormat(e.target.value)}>
              {HAP_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>{f.name} - {f.description}</option>
              ))}
            </select>
          </div>
          <div className="control-row">
            <label>Chunks</label>
            <input
              type="number"
              value={hapChunks}
              onChange={(e) => setHapChunks(Math.max(1, Math.min(64, parseInt(e.target.value) || 4)))}
              min={1}
              max={64}
            />
          </div>
        </>
      )}

      {/* Quality/Bitrate (for delivery codecs) */}
      {['libx264', 'libx265', 'libvpx_vp9', 'libsvtav1'].includes(codec) && (
        <>
          <div className="control-row">
            <label>
              <input
                type="checkbox"
                checked={useQuality}
                onChange={(e) => setUseQuality(e.target.checked)}
              />
              Use CRF (Quality)
            </label>
          </div>
          {useQuality ? (
            <div className="control-row">
              <label>Quality (CRF)</label>
              <input
                type="range"
                min={0}
                max={51}
                value={quality}
                onChange={(e) => setQuality(parseInt(e.target.value))}
              />
              <span>{quality}</span>
            </div>
          ) : (
            <div className="control-row">
              <label>Bitrate</label>
              <input
                type="range"
                min={1000000}
                max={100000000}
                step={500000}
                value={bitrate}
                onChange={(e) => setBitrate(parseInt(e.target.value))}
              />
              <span>{(bitrate / 1000000).toFixed(1)} Mbps</span>
            </div>
          )}
        </>
      )}

      {/* Export Button */}
      <button
        className="btn export-start-btn"
        onClick={handleExport}
        disabled={isExporting || isLoading}
      >
        {isExporting ? `Exporting... ${progress?.percent.toFixed(1) || 0}%` : 'Export with FFmpeg'}
      </button>

      {/* Progress */}
      {isExporting && progress && (
        <div className="export-progress">
          <div className="export-progress-bar">
            <div
              className="export-progress-fill"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <div className="export-progress-info">
            <span>Frame {progress.frame}</span>
            <span>{progress.fps.toFixed(1)} fps</span>
            <span>{progress.speed.toFixed(2)}x</span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && <div className="export-error">{error}</div>}
    </div>
  );
}
```

---

## Phase 4: Integration

### 4.1 Update ExportPanel.tsx

Add FFmpegExportSection after existing WebCodecs export:

```typescript
// In ExportPanel.tsx, add import:
import { FFmpegExportSection } from './FFmpegExportSection';

// In render, after existing export sections:
<FFmpegExportSection
  width={useCustomResolution ? customWidth : width}
  height={useCustomResolution ? customHeight : height}
  fps={fps}
  startTime={startTime}
  endTime={endTime}
  onExport={async (settings) => {
    // Render all frames and return as Uint8Array[]
    const frames: Uint8Array[] = [];
    const totalFrames = Math.ceil((settings.endTime - settings.startTime) * settings.fps);

    for (let i = 0; i < totalFrames; i++) {
      const time = settings.startTime + (i / settings.fps);
      // Seek and render
      await seekToTime(time);
      const pixels = await engine.readPixels();
      if (pixels) frames.push(pixels);
    }

    return frames;
  }}
/>
```

---

## Phase 5: Testing

### 5.1 Create test file

```typescript
// test/ffmpeg-codecs.test.ts

import { getFFmpegBridge } from '../src/engine/ffmpeg';

describe('FFmpeg Codecs', () => {
  const ffmpeg = getFFmpegBridge();

  beforeAll(async () => {
    await ffmpeg.load();
  }, 60000); // 60s timeout for loading

  const testFrame = new Uint8Array(1920 * 1080 * 4); // RGBA

  test('ProRes HQ encoding', async () => {
    const blob = await ffmpeg.encode([testFrame], {
      codec: 'prores',
      container: 'mov',
      width: 1920,
      height: 1080,
      fps: 24,
      proresProfile: 'hq',
      startTime: 0,
      endTime: 1,
    });
    expect(blob.size).toBeGreaterThan(0);
  });

  test('HAP Q encoding', async () => {
    const blob = await ffmpeg.encode([testFrame], {
      codec: 'hap',
      container: 'mov',
      width: 1920,
      height: 1080,
      fps: 30,
      hapFormat: 'hap_q',
      startTime: 0,
      endTime: 1,
    });
    expect(blob.size).toBeGreaterThan(0);
  });

  test('DNxHR HQ encoding', async () => {
    const blob = await ffmpeg.encode([testFrame], {
      codec: 'dnxhd',
      container: 'mxf',
      width: 1920,
      height: 1080,
      fps: 24,
      dnxhrProfile: 'dnxhr_hq',
      startTime: 0,
      endTime: 1,
    });
    expect(blob.size).toBeGreaterThan(0);
  });
});
```

---

## Implementation Checklist

### Phase 1: Build Infrastructure
- [ ] Create `ffmpeg-wasm/` directory structure
- [ ] Write Dockerfile
- [ ] Write build-libs.sh
- [ ] Write build-ffmpeg.sh
- [ ] Write build-wasm.sh
- [ ] Test Docker build
- [ ] Verify WASM output size

### Phase 2: TypeScript Integration
- [ ] Create types.ts
- [ ] Create codecs.ts with all codec definitions
- [ ] Create FFmpegBridge.ts
- [ ] Create index.ts exports
- [ ] Test basic loading

### Phase 3: UI Components
- [ ] Create CodecSelector.tsx
- [ ] Create FFmpegExportSection.tsx
- [ ] Add platform presets
- [ ] Style components

### Phase 4: Integration
- [ ] Update ExportPanel.tsx
- [ ] Connect frame rendering pipeline
- [ ] Add progress reporting
- [ ] Handle errors gracefully

### Phase 5: Testing & Polish
- [ ] Test all codecs
- [ ] Profile memory usage
- [ ] Add loading indicator
- [ ] Documentation
- [ ] Optimize WASM loading (lazy, cached)

---

## Notes

- FFmpeg WASM is GPL licensed (due to x264/x265)
- WASM loads on-demand, not at startup
- Memory: Allocate ~256MB initial, grow to 2GB max
- Use Web Worker to avoid blocking UI
- Cache WASM in IndexedDB for faster subsequent loads

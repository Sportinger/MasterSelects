#!/usr/bin/env bash
# Builds a pure-LGPL libavcodec WASM decoder (no libavformat, no GPL, no pthreads).
# Runs inside the emscripten/emsdk container. Usage: ./build.sh <decoders,comma,separated>
#   docker run --rm -v "$PWD:/w" -w /w emscripten/emsdk:3.1.50 bash build.sh mpeg2video,dnxhd,h264
set -euo pipefail
DECODERS="${1:-mpeg2video,dnxhd,h264}"
PARSERS="${2:-h264,mpegvideo}"
FFMPEG_TAG="${FFMPEG_TAG:-n7.1.1}"
WORK=/tmp/build; mkdir -p "$WORK"; cd "$WORK"
[ -d ffmpeg ] || git clone --depth 1 --branch "$FFMPEG_TAG" https://github.com/FFmpeg/FFmpeg.git ffmpeg
cd ffmpeg
git rev-parse HEAD > /w/FFMPEG_REVISION
emconfigure ./configure --prefix=/opt/ffmpeg --cc=emcc --cxx=em++ --ar=emar --ranlib=emranlib \
  --target-os=none --arch=x86_32 --enable-cross-compile \
  --disable-everything --disable-all --disable-gpl --disable-nonfree --disable-version3 \
  --disable-programs --disable-doc --disable-network --disable-autodetect --disable-asm --disable-stripping \
  --disable-pthreads --disable-debug --enable-avcodec --enable-avutil --enable-small=no \
  --enable-decoder="$DECODERS" --enable-parser="$PARSERS" \
  --extra-cflags="-O3 -msimd128 -fno-exceptions" --extra-ldflags="-msimd128"
emmake make -j"$(nproc)" install 2>&1 | tail -3
cd /w
emcc -O3 -msimd128 shim.c -I/opt/ffmpeg/include -L/opt/ffmpeg/lib -lavcodec -lavutil \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU16 -sEXPORT_NAME=createLibavcodec -sFILESYSTEM=0 \
  -o out/libavcodec.js
ls -la out

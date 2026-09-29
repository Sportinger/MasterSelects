#!/usr/bin/env bash
# Builds a pure-LGPL libavcodec WASM decoder (no libavformat, no GPL, no pthreads).
# Runs inside the emscripten/emsdk container. Usage: ./build.sh <decoders,comma,separated>
#   docker run --rm -v "$PWD:/w" -w /w emscripten/emsdk:3.1.50 bash build.sh mpeg2video,dnxhd,h264
set -euo pipefail
DECODERS="${1:-mpeg2video,dnxhd,h264}"
PARSERS="${2:-h264,mpegvideo}"
FFMPEG_TAG="${FFMPEG_TAG:-n7.1.1}"  # commit db69d06eeeab4f46da15030a80d539efb4503ca8
WORK="${WORK:-/tmp/build}"; mkdir -p "$WORK"; cd "$WORK"
[ -d ffmpeg ] || git clone --depth 1 --branch "$FFMPEG_TAG" https://github.com/FFmpeg/FFmpeg.git ffmpeg
cd ffmpeg
git rev-parse HEAD > "${OUTDIR:-/w}/FFMPEG_REVISION"
# configure is run directly (emconfigure cannot exec shell scripts on Windows); needs a host clang for C11 probing.
# Windows/Git Bash: put emsdk upstream/emscripten + upstream/bin + GNU make on PATH, set TMPDIR to a writable dir.
./configure --prefix="${PREFIX:-/opt/ffmpeg}" --cc=emcc --cxx=em++ --ar=emar --ranlib=emranlib --nm=llvm-nm --host-cc=clang \
  --target-os=none --arch=x86_32 --enable-cross-compile \
  --disable-everything --disable-all --disable-gpl --disable-nonfree --disable-version3 \
  --disable-programs --disable-doc --disable-network --disable-autodetect --disable-asm --disable-pthreads --disable-debug \
  --enable-avcodec --enable-avutil --enable-decoder="$DECODERS" --enable-parser="$PARSERS" \
  --extra-cflags="-O3 -msimd128"
make -j"$(nproc)" install
I="${PREFIX:-/opt/ffmpeg}"
cd "${OUTDIR:-/w}"
EXP='["_dec_open","_dec_send","_dec_receive","_dec_flush","_dec_close","_dec_width","_dec_height","_dec_pix_fmt","_dec_pts","_dec_interlaced","_dec_tff","_dec_plane","_dec_stride","_dec_malloc","_dec_free"]'
emcc -O3 -msimd128 shim.c -I"$I/include" -L"$I/lib" -lavcodec -lavutil \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker,node -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB \
  -sEXPORTED_FUNCTIONS="$EXP" -sEXPORT_NAME=createLibavcodec -sFILESYSTEM=0 -o out/libavcodec.js
ls -la out

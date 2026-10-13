# libavcodec WASM decoder (MXF and HEVC browser decode)

- Upstream: https://github.com/FFmpeg/FFmpeg, tag `n7.1.1` (commit `db69d06eeeab4f46da15030a80d539efb4503ca8`)
- License: **LGPL-2.1-or-later** (see `LICENSE`). Configured with `--disable-gpl --disable-nonfree
  --disable-version3`; FFmpeg's configure reports "License: LGPL version 2.1 or later".
- Toolchain: emsdk 3.1.50, `-O3 -msimd128`, no pthreads, no libavformat, no filesystem.
- Enabled: decoders `mpeg2video,dnxhd,h264,hevc`, parsers `h264,hevc,mpegvideo`, libraries `avcodec,avutil`.
  The H.264 decoder is compiled in but unused by the editor (H.264 goes through WebCodecs).
- Glue: `tools/libavcodec-wasm/shim.c` (dec_open/dec_send/dec_receive/... C API).
  The build script makes Emscripten’s Node-only `module` import conditional so browser workers can load the glue.
  FFmpeg sources are unmodified. The HEVC build includes the actual AOM film-grain cleanup.
- Rebuild: `tools/libavcodec-wasm/build.sh` holds the configure and link flags. These files can be
  replaced by a user-built `libavcodec.js`/`libavcodec.wasm` exposing the same C API (LGPL relinking).

| File | SHA-256 |
|---|---|
| libavcodec.js | `83155318a714fa8546e92d817914bcf463841db76fb73902ed12366e9b8095c7` |
| libavcodec.wasm | `d827a36bfe58722f9da0c99e1b64beb3ee3204774c6c6d6be19560289f90787f` |

Loaded on demand by `src/workers/libavDecodeWorker.ts` when MXF DNxHD/DNxHR, MPEG-2 essence, or HEVC without a working native decoder is decoded; not part of the initial app bundle.

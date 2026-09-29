# libavcodec WASM decoder (MXF browser decode)

- Upstream: https://github.com/FFmpeg/FFmpeg, tag `n7.1.1` (commit `db69d06eeeab4f46da15030a80d539efb4503ca8`)
- License: **LGPL-2.1-or-later** (see `LICENSE`). Configured with `--disable-gpl --disable-nonfree
  --disable-version3`; FFmpeg's configure reports "License: LGPL version 2.1 or later".
- Toolchain: emsdk 3.1.50, `-O3 -msimd128`, no pthreads, no libavformat, no filesystem.
- Enabled: decoders `mpeg2video,dnxhd,h264`, parsers `h264,mpegvideo`, libraries `avcodec,avutil`.
  The H.264 decoder is compiled in but unused by the editor (H.264 goes through WebCodecs).
- Glue: `tools/libavcodec-wasm/shim.c` (dec_open/dec_send/dec_receive/... C API), including an
  empty `ff_aom_uninit_film_grain_params` stub: `h2645_sei.o` references it while
  `aom_film_grain.c` is only built with HEVC. FFmpeg sources are unmodified.
- Rebuild: `tools/libavcodec-wasm/build.sh` holds the configure and link flags. These files can be
  replaced by a user-built `libavcodec.js`/`libavcodec.wasm` exposing the same C API (LGPL relinking).

| File | SHA-256 |
|---|---|
| libavcodec.js | `d524d247510ed13f41f7ce6f7b76cbf75c0064c212722f27858cd8a7d1bd7092` |
| libavcodec.wasm | `bf3890b04b3364931a1a6664ac2353fb82849de2c0911a98b36898ef8255eb09` |

Loaded on demand by `src/workers/libavDecodeWorker.ts` only when MXF DNxHD/DNxHR or MPEG-2 Intra
essence is decoded; not part of the initial app bundle.

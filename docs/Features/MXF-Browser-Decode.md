# MXF Browser Decode

Status: **in development, behind the `mxfBrowserDecode` engine flag** — on in the dev server,
off in production builds (`window.__ENGINE_FLAGS__.mxfBrowserDecode` toggles it at runtime).

Goal: import, preview, scrub, and export MXF files entirely in the browser through the same
`RuntimeFrameProvider` boundary as ProRes (TurboRes) and HAP. No server, no native helper.

## Architecture

- **Demux in TypeScript.** `src/services/mediaMetadata/mxf/` reads partitions, the Random Index
  Pack, the primer pack, header-metadata sets and index table segments with range reads on the
  `File`. Import metadata never loads WASM.
- **Decode per essence.** WebCodecs first where the browser can decode the essence (H.264);
  ProRes in MXF goes to TurboRes; DNxHD/DNxHR and MPEG-2 use a separate, pure-LGPL libavcodec
  WASM build (`tools/libavcodec-wasm/`, not `@ffmpeg/core`). Parallelism comes from multiple
  workers, not pthreads.
- **Long GOP.** `MxfGopFrameProvider` decodes from the previous key frame in stored order, reorders
  by timestamp, keeps up to six upcoming frames and continues forward without a reset (playback,
  export, proxy). Decoders plug in as `GopDecoder`: WebCodecs for H.264, a streaming libavcodec
  worker for MPEG-2. Reverse playback restarts at the key frame for each frame (slow at 4K).
- **Codec provider backends.** Every codec backend is a descriptor in
  `src/services/mediaRuntime/codec/codecProviderDescriptors.ts` on top of
  `CodecFrameProviderBase` (latest-wins queue, epochs, prefetch, exact seek). Playback, thumbnails,
  proxy and export read the descriptor instead of branching on backend names.

## Codec ids

MXF picture essence gets namespaced `videoCodecId` values so an MP4 `avc1` never routes into the
MXF path. ProRes keeps its real FourCC (`apch`, …) and therefore the TurboRes backend.

| Essence | `videoCodecId` | Decode path | Status |
|---|---|---|---|
| ProRes (RDD 44) | `apco`/`apcs`/`apcn`/`apch`/`ap4h`/`ap4x` | TurboRes via `MxfPacketSource` | ✓ preview, scrub, thumbnails |
| DNxHD / DNxHR | `mxf:dnxhd` | libavcodec WASM worker pool (`mxf-libav`) | ✓ decoder wired |
| IMX / D-10 (MPEG-2 4:2:2 Intra) | `mxf:mpeg2-intra` | libavcodec WASM worker pool (`mxf-libav`), VBI cropped | ✓ decoder wired; blend-deinterlaced |
| XDCAM HD422 (MPEG-2 Long GOP) | `mxf:mpeg2-lgop` | one stateful libavcodec worker via `MxfGopFrameProvider` | ✓ decoder wired; blend-deinterlaced |
| XAVC-I / AVC-Intra | `mxf:avc-intra` | WebCodecs (`mxf-avc` backend) | ✓ decoder wired |
| XAVC Long GOP | `mxf:avc-lgop` | WebCodecs, decode from previous key frame (`mxf-avc`) | ✓ decoder wired (verified parse of a 38-min Sony XAVC 4K file) |
| JPEG 2000, unknown | `mxf:unsupported:<reason>` | – | explicit "not supported" |

## Interlaced essence

Frames the libavcodec decoder flags as interlaced (IMX/D-10, XDCAM HD422 1080i) are
blend-deinterlaced in the decode worker ((above + 2·line + below) / 4 per plane), on by default
(plan D3). Not yet: per-clip switch, field-rate bob/yadif on the GPU, interlaced H.264 through
WebCodecs, interlaced ProRes.

## Audio

Frame-wrapped PCM (SMPTE 382 BWF/AES3 sound elements, e.g. Sony's four mono tracks) is streamed
edit unit by edit unit into the 16-bit WAV audio proxy (`mxfPcmWav.ts`); index slices locate the
sound elements after the picture so each edit unit costs one small read. Mapping v1: A1 → left,
A2 → right (a single mono track is doubled, a stereo track is used as is). Playback, scrubbing and
export use the regular audio-proxy path. D-10 (IMX) AES3 sound elements (4-byte header, 8 channel slots, 24-bit audio in bits 4–27)
are read the same way. Not yet: clip-wrapped (OP-Atom) audio files, choosing other track pairs.

Until a codec's decoder exists, its plan is `{ backend: 'unsupported', reason:
'mxf-decoder-unavailable' }`, so the editor reports it instead of showing a black
`<video>` element.

## libavcodec WASM

`public/wasm/libavcodec/` ships the LGPL build (1.6 MB, replaceable, see its `SOURCE.md`); the
decoder runs in `src/workers/libavDecodeWorker.ts`, which builds `I422`/`I420`/`I422P10` VideoFrames
in the worker and transfers them. `MxfLibavFrameProvider` uses 1–4 workers depending on policy and
frame size and decodes upcoming frames in parallel during forward playback. Thumbnail consumers get
8-bit output. Measured decode rates are in the maintainer plan (DNxHR HQ: ~75 fps per worker at
1080p, ~20 fps at 4K).

## Metadata

Imported from the header metadata of the file source package: visible and stored size (1088-line
and D-10 VBI storage are reported as coded size), edit rate, duration in edit units, frame layout
and field dominance, bit depth, chroma subsampling, aspect ratio (as pixel aspect ratio), AVC
profile/level, audio tracks (channels, sample rate, bit depth, AES3-in-picture for D-10), start
timecode, and whether the index marks every edit unit as a key frame (Intra vs. Long GOP).

## Tests and fixtures

- `tools/mxf-fixtures/generate.sh small` writes 256×128 fixtures with ffprobe golden JSON to
  `tests/fixtures/mxf/`; `bench` writes 1080p/4K files (set `MXF_OUT` to keep them off the repo).
- `tests/unit/mxfMetadata.test.ts` compares the parser against the ffprobe goldens.
- `tools/libavcodec-wasm/bench.mjs` measures WASM decode fps per worker.

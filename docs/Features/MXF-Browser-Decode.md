# MXF Browser Decode

Status: **in development, behind the `mxfBrowserDecode` engine flag (default off).**
Toggle for local testing with `window.__ENGINE_FLAGS__.mxfBrowserDecode = true` before importing.

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
- **Codec provider backends.** Every codec backend is a descriptor in
  `src/services/mediaRuntime/codec/codecProviderDescriptors.ts` on top of
  `CodecFrameProviderBase` (latest-wins queue, epochs, prefetch, exact seek). Playback, thumbnails,
  proxy and export read the descriptor instead of branching on backend names.

## Codec ids

MXF picture essence gets namespaced `videoCodecId` values so an MP4 `avc1` never routes into the
MXF path. ProRes keeps its real FourCC (`apch`, …) and therefore the TurboRes backend.

| Essence | `videoCodecId` | Decode path | Status |
|---|---|---|---|
| ProRes (RDD 44) | `apco`/`apcs`/`apcn`/`apch`/`ap4h`/`ap4x` | TurboRes | metadata ✓, playback pending (MXF packet source) |
| DNxHD / DNxHR | `mxf:dnxhd` | libavcodec WASM | metadata ✓, decoder pending |
| IMX / D-10 (MPEG-2 4:2:2 Intra) | `mxf:mpeg2-intra` | libavcodec WASM | metadata ✓, decoder pending |
| XDCAM HD422 (MPEG-2 Long GOP) | `mxf:mpeg2-lgop` | libavcodec WASM + GOP provider | metadata ✓, decoder pending |
| XAVC-I / AVC-Intra | `mxf:avc-intra` | WebCodecs | metadata ✓, decoder pending |
| XAVC Long GOP | `mxf:avc-lgop` | WebCodecs + GOP provider | metadata ✓, decoder pending |
| JPEG 2000, unknown | `mxf:unsupported:<reason>` | – | explicit "not supported" |

Until a codec's decoder exists, its plan is `{ backend: 'unsupported', reason:
'mxf-decoder-unavailable' }`, so the editor reports it instead of showing a black
`<video>` element.

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

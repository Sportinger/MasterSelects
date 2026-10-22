Moving test footage for the docs clips (`scripts/doc-clip.mjs`, `node scripts/docs-media.mjs`).
Generated with Kling for MasterSelects by its owner; free to use in this project.

- `dancer_stage_motion.mp4` – a dancer turning on a dark stage, 6 s, 24 fps, 1920×1080 H.264
  (no audio, 3.6 MB), re-encoded from the original (CRF 21, preset slow, tune film, aq-mode 3
  against banding on the dark curtain; SSIM 0.990 Y, 0.992 overall against it). It keeps the pleats
  of the dress that the 2× detail loops enlarge. The docs clips render it in a 1920×1080 frame, so the
  `crop` values of the clip recipes are 1080p pixels.
- Its colours are the original's: the original is untagged, so the re-encode keeps its YUV values as
  they are and only tags the stream BT.709 limited range afterwards (an `h264_metadata` bitstream
  filter). Tagging the output with ffmpeg's `-colorspace`/`-color_range` options instead makes ffmpeg
  convert every frame through RGB, which made an earlier copy 5 to 7 % darker. The command:

  ```sh
  ffmpeg -i original.mp4 -c:v libx264 -preset slow -tune film -crf 21 -x264-params aq-mode=3 \
    -pix_fmt yuv420p -an -movflags +faststart \
    -bsf:v h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1 \
    dancer_stage_motion.mp4
  ```

  `tests/unit/docsMediaRecipes.test.ts` checks the mean Y, U and V of three frames against the
  original's (when ffprobe is installed). After replacing the footage, run
  `node scripts/docs-media.mjs --adopt <effect ids of its clips>` if the clips were made from the
  same picture, or `--stale` to make them again.

- `black_1080_10s.mp4` – plain black (Y 16 in every frame), 10 s, 30 fps, 1920×1080 H.264, no audio
  (27 KB): the clip under the generators that draw on black (Weave, Flocking, Stick Figure;
  `scripts/doc-clips/scene.json` and `generate.json`). An equivalent one:
  `ffmpeg -f lavfi -i color=black:s=1920x1080:r=30:d=10 -c:v libx264 -pix_fmt yuv420p -an black_1080_10s.mp4`.

The green-screen still for keyers is `../images/greenscreen_dancer.jpg`.

Which footage the tools use is one setting: `footageDir` in `scripts/docShotSettings.mjs`
(or `DOCS_FOOTAGE_DIR`, or `--media <folder>` for one run, e.g. the 1080p original).

Moving test footage for the docs clips (`scripts/doc-clip.mjs`, `node scripts/docs-media.mjs`).
Generated with Kling for MasterSelects by its owner; free to use in this project.

- `dancer_stage_motion.mp4` – a dancer turning on a dark stage, 6 s, 24 fps, 1920×1080 H.264
  (BT.709, no audio, 3.8 MB), re-encoded from the original (CRF 21, preset slow, tune film,
  aq-mode 3 against banding on the dark curtain; SSIM 0.993 against it). It keeps the pleats of the
  dress that the 2× detail loops enlarge. The docs clips render it in a 1920×1080 frame, so the `crop` values of the clip
  recipes are 1080p pixels.

The green-screen still for keyers is `../images/greenscreen_dancer.jpg`.

Which footage the tools use is one setting: `footageDir` in `scripts/docShotSettings.mjs`
(or `DOCS_FOOTAGE_DIR`, or `--media <folder>` for one run, e.g. the 1080p original).

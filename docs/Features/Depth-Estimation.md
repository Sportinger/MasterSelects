# AI Depth Map

Select a video clip and open **Properties > Tracking > AI Depth Map**.

- **Download depth model** loads Depth Anything V2 Small directly from Hugging
  Face (99,060,839 bytes, FP32). The pinned model is SHA-256 verified and stored in
  a dedicated browser Cache Storage cache. A corrupt cached file is discarded.
  Cache failures leave the model usable for the session. No video is uploaded.
- **Estimate current frame** shows relative inverse depth: white is near, black
  is far. **Start live depth** follows the playhead until stopped or the panel
  closes. The source timestamp and inference time are displayed; this is an
  asynchronous analysis preview, not guaranteed full-framerate playback.
- **Fast** uses a 280-pixel long edge; **Detailed** uses 518. Input dimensions are
  multiples of 14. The source aspect ratio is retained when displaying/exporting.
- Range smoothing stabilizes the 2nd/98th percentile display range; it does not
  smear moving geometry. Seeking backwards, large jumps and range discontinuities
  reset history. Polarity can be inverted.
- **Bake depth video to Media** deterministically analyzes the chosen source
  range at 10, 15 or 30 fps, then imports a silent grayscale H.264 MP4. The range
  is bounded to 120 seconds. The map starts at output time zero corresponding to
  **Source start**. It excludes clip transforms, effects, speed changes and audio;
  apply matching timing/transforms when aligning it with an edited clip. Once
  baked, it uses ordinary media playback, project storage and export, without ML.
- **Stop depth** cancels decoding/download/inference and keeps previously imported
  results. **Unload model** releases the worker/GPU while retaining the download;
  **Clear model cache** also removes its downloaded weights.

## Runtime and provenance

`src/services/depthEstimation/` separates verified model loading, worker ownership,
relative-depth math and sequential video baking. Runtime objects remain outside
project data and stores. The HMR-preserved runtime owns one worker and permits one
inference at a time; no playback-sized job queue is accumulated. Worker requests
have a two-minute timeout. Model execution uses the existing Transformers.js
runtime, with WebGPU preferred and an explicitly labelled WASM fallback.
Transformers.js runtime assets load from its versioned jsDelivr distribution;
model cache availability alone therefore does not guarantee a fully offline cold
start. Backend performance is device dependent.

Model: [onnx-community/depth-anything-v2-small](https://huggingface.co/onnx-community/depth-anything-v2-small),
revision `4472b7362082ad9968fee890ca0f1e5aca36b93d`, file `onnx/model.onnx`,
SHA-256 `afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c`.
The source model and conversion identify Apache-2.0; see
[third-party notices](../../THIRD_PARTY_NOTICES.md).

## Boundaries

This produces **relative monocular depth**, not distances in meters or a complete
3D mesh. The analysis preview is in source space. **Face Cables > Native 3D scene >
Scene depth** reuses this model during cable baking to add a textured depth surface
outside the MediaPipe face. It stores calibrated depth alongside the cable scene;
the standalone grayscale depth video is not required. The surface receives cable
shadows and participates in scene depth testing. **Collide with scene depth** adds
cable contact with that exterior surface while MediaPipe retains face contact.
Depth and cable motion persist in the project; **Rebake physics** reuses the saved
depth without inference when only cable settings or collision controls change.
Voxel Relief depth sampling is not yet connected.
The depth-aware Voxel Relief orchestration plan remains open; this feature does
not mark its broader renderer/export/3D scope complete.

## Slit Scan time maps

Slit Scan's external time-field source includes the existing depth controls and a
**Bake and use as time map** action. It imports the baked video into Media with
source ID/fingerprint, source range, FPS, polarity and model revision metadata,
then assigns it to the effect. The same metadata is saved for ordinary depth
bakes. A changed source or composition prevents automatic assignment.

**Depth source** alignment follows the clip's source clock, including trim,
reverse, speed and Time factor bypass. **Timeline (free)** retains the independent
`Map start` offset. Selecting a depth asset sets luminance and the polarity for
near pixels at the current time and far pixels in the past. Missing provenance,
a mismatched source fingerprint or an uncovered source time produces an explicit
error. Stabilized source alignment applies the source's UV transform; incomplete
tracking stops this aligned map instead of combining different coordinate spaces.

Video maps use shared source decoding and direct GPU upload, with a maximum
640-pixel edge. They do not allocate a second full source-history atlas. Bake
limits remain 120 source seconds and 10/15/30 FPS. Depth is relative and the H.264
map is quantized. Live GPU, save/load and export verification of this integration
is pending.

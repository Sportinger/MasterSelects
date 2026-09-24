# Third-Party Notices

MasterSelects includes the following third-party software. Each component
remains available under its own license terms.

## SAM 2.1 Tiny video segmentation (optional download)

- Original model: <https://github.com/facebookresearch/sam2>
- Copyright: Meta Platforms, Inc. and affiliates
- ONNX conversion: <https://huggingface.co/square-zero-labs/sam2.1-tiny-video-onnx>
- Conversion revision: `3b2984dd865f6e9d2cc6aed0be6a5a5c2eb352ce`
- License: Apache-2.0; original license: <https://github.com/facebookresearch/sam2/blob/main/LICENSE>
- Five model files are downloaded on demand from Hugging Face and verified by
  SHA-256. They are not hosted by MasterSelects. The conversion's learned
  preprocessing and temporal constants are included in
  `src/services/roto/sam21Constants.json`; the editor's AGPL license does not
  replace their Apache-2.0 terms.

## Retained MasterSelects source notices

This source tree includes material from earlier MasterSelects versions published
under the MIT License. Its copyright and permission notice is retained in
[licenses/MIT-MasterSelects-Legacy.txt](licenses/MIT-MasterSelects-Legacy.txt).
The AGPL license of the current combined editor does not revoke those earlier
permissions or replace licenses applicable to independently identified material.

## Dependency and bundled-component notices

The dependency attribution inventory is available in
[dependency attributions](docs/completed/misc/FOSSA-Attribution.html). Bundled Brush and OpenCV
components have their own notices in [public/wasm/brush/LICENSE](public/wasm/brush/LICENSE)
and [public/wasm/opencv/LICENSE](public/wasm/opencv/LICENSE). Optional model downloads
may have additional terms, including non-commercial restrictions; the editor's
AGPL license does not relicense those models.

## TurboRes

- Project: <https://github.com/Vanilagy/turbores>
- Version: 1.2.2
- Copyright: 2026-present, Vanilagy and contributors
- License: Mozilla Public License 2.0
- License text: <https://www.mozilla.org/MPL/2.0/>

TurboRes is used as an unmodified npm dependency for browser-local Apple ProRes
decoding. Its source code is available from the project link above.


## Depth Anything V2 Small (optional download)

- Original model: <https://huggingface.co/depth-anything/Depth-Anything-V2-Small>
- ONNX conversion: <https://huggingface.co/onnx-community/depth-anything-v2-small>
- Conversion revision: `4472b7362082ad9968fee890ca0f1e5aca36b93d`
- License declared by the original Small model and ONNX conversion: Apache-2.0
- Original project and license: <https://github.com/DepthAnything/Depth-Anything-V2>
- Weights are downloaded directly from Hugging Face on demand, not bundled or
  hosted by MasterSelects. The fixed FP32 artifact is hash-verified before use.
- Inference uses the existing Apache-2.0 Transformers.js and MIT ONNX Runtime
  dependencies. Runtime assets load from the versioned Transformers.js CDN path.

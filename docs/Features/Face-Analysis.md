# Browser Face Analysis: YuNet + SFace

MasterSelects can analyze video clips for faces without the Native Helper and
without uploading frames to a cloud service. The implementation uses:

- OpenCV YuNet (`face_detection_yunet_2026may.onnx`) for face boxes and five
  facial landmarks.
- OpenCV SFace (`face_recognition_sface_2021dec.onnx`) for anonymous,
  source-local identity grouping.
- ONNX Runtime Web in a dedicated browser worker. WebGPU is attempted first
  and the worker rebuilds both sessions on WASM if WebGPU initialization or
  inference fails.

The first run downloads about 39 MB of pinned model files. MasterSelects checks
their exact size and SHA-256 hash and stores valid responses in the browser
cache. Later runs reuse that cache.

## Results

The durable clip result contains sampled source timestamps, normalized face
boxes, five normalized landmarks, detection confidence, and anonymous labels
such as `Person 1`. It also contains compact appearance ranges and the actual
runtime backend. Raw SFace embeddings exist only transiently while a clip is
being analyzed. They are not stored in project data and are never returned to
the AI chat.

Select an analyzed video clip to see its boxes, landmarks, and anonymous person
labels over the Preview. Existing yellow face markers remain available on the
timeline.

Identity labels are local to one complete analysis pass. Re-analyzing a clip
may assign different numbers, and the labels do not identify real-world names.

## AI chat

The Media-panel AI can start and inspect analysis:

- `startClipFaceAnalysis({ clipId })` starts the browser job.
- `getClipFaceAnalysis({ clipId })` polls status and returns people plus source
  and timeline appearance ranges.
- `getClipFaceAnalysis({ clipId, includeObservations: true, limit: 20 })`
  returns bounded sampled boxes and landmarks.

Download, model-load, worker, and inference failures are stored on the clip.
The read tool returns the exact module error with `success: false`, so the AI
can report it rather than claiming that no analysis exists.

## Performance

Video frames are sampled every 500 ms. Motion analysis keeps its existing
lower-resolution path; faces use an independent aspect-preserving frame whose
long edge is at most 640 pixels. Preprocessing and five-point alignment use
typed arrays rather than `OffscreenCanvas`, preserving the Linux/Mesa
main-thread fallback rules.

WebGPU performance depends on the browser and GPU driver. WASM is the portable
fallback and is expected to be slower, especially when several faces require
SFace inference in one sample.

## Models and licenses

- [YuNet in OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet)
  is distributed under the model directory's MIT license.
- [SFace in OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface)
  is distributed under the model directory's Apache-2.0 license.
- Post-processing and alignment follow OpenCV's
  [FaceDetectorYN](https://github.com/opencv/opencv/blob/4.x/modules/objdetect/src/face_detect.cpp)
  and
  [FaceRecognizerSF](https://github.com/opencv/opencv/blob/4.x/modules/objdetect/src/face_recognize.cpp)
  implementations.


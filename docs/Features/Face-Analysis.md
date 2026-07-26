# Browser Face Analysis: YuNet + SFace

MasterSelects can analyze video clips for faces without the Native Helper and
without uploading frames to a cloud service. The implementation uses:

- OpenCV YuNet (`face_detection_yunet_2026may.onnx`) for face boxes and five
  facial landmarks.
- OpenCV SFace (`face_recognition_sface_2021dec.onnx`) for anonymous,
  source-local identity grouping.
- ONNX Runtime Web's WASM backend in a dedicated browser worker. This keeps
  face analysis independent from the editor's WebGPU renderer and avoids a
  driver-level WebGPU model-initialization hang seen on some Windows systems.

The first run downloads about 39 MB of pinned model files. MasterSelects checks
their exact size and SHA-256 hash and stores valid responses in the browser
cache. Later runs reuse that cache.

## Results

The durable result is a versioned `Analysis/<media-id>.json` artifact inside
the project folder. It contains sampled source timestamps, normalized face
boxes, five normalized landmarks, detection confidence, anonymous labels such
as `Person 1`, compact appearance ranges, and the actual runtime backend.
Project loading restores this sidecar whenever a clip needs analysis hydration;
it never requires browser-cache data. Raw SFace embeddings exist only
transiently while a clip is being analyzed. They are not stored in project data
and are never returned to the AI chat.

Analysis belongs to the imported video source, not to one timeline clip ID.
Trimming changes only the clip's visible source-time window. Splits, range cuts,
and copy/paste derivatives keep the same immutable in-memory analysis object
and refer to the same `Analysis/<media-id>.json` sidecar. New timeline instances
hydrate compatible motion and face data from that source artifact, and face
corrections or clearing analysis are published to every clip that uses it.

Select an analyzed video clip to see its boxes, landmarks, and anonymous person
labels over the Preview. Existing yellow face markers remain available on the
timeline. The timeline assigns every anonymous person a stable colour: their
sample dots and source-time range bands share that colour. The Analysis tab
shows each person as one compact face thumbnail with sightings and confidence
overlaid. Clicking that thumbnail toggles a separate strip of distinct
appearances and manually moved crops for the same group. Small
yellow detections that are unsafe to identify appear in a separate **Needs
review** gallery. Repeated detections are consolidated into short visual tracks
without claiming an identity; dragging a review card onto a confirmed person
assigns that track manually. These previews are generated only after analysis
completes, stay in a bounded browser-memory cache, and are also persisted as
versioned JPEGs under `Cache/face-thumbnails` so they load without video seeks
after a refresh or project reopen. Clicking an appearance crop jumps to its
source appearance.

The top of the Analysis tab exposes separate action rows for **Focus & Motion**,
**Faces**, **Scene Cuts**, and **AI Scenes**. Every row can be analyzed,
reanalyzed, retried, or cancelled without clearing the other results. A
metrics-only pass preserves compatible face observations. A face-only pass
reuses existing focus and motion samples; when no metrics exist yet, it creates
the inexpensive metrics baseline during the same source decode. The rows remain
in a two-column grid, and **Analyze All** executes the independent pipelines
sequentially to keep decoder and GPU load bounded.

Toggle **Face Ranges**
from the timeline's **View** menu or by right-clicking a face-analyzed video
clip; the switch is global and does not alter clip data.

Identity labels are local to one complete analysis pass. Re-analyzing a clip
may assign different numbers, and the labels do not identify real-world names.
The tracker uses SFace's calibrated cosine boundary plus a small transient set
of pose exemplars per identity, reducing false splits caused by lighting,
profile views, and partial occlusion. A tracker revision requires re-analysis;
the model files remain cached.

## AI chat

The Media-panel AI can start and inspect analysis:

- `startClipFaceAnalysis({ clipId })` starts the browser job.
- `getClipFaceAnalysis({ clipId })` polls status and returns people plus source
  and timeline appearance ranges, the queried `timelineRange`, and bounded
  yellow **Needs review** visual tracks with representative boxes. Each
  appearance is already mapped to the current clip timeline.
- `getClipFaceAnalysis({ clipId, includeObservations: true, limit: 20 })`
  returns bounded sampled boxes and landmarks, including whether each
  observation is identity-eligible, needs review, or was assigned manually.
- `personId` accepts an exact analysis ID or a visible label/shorthand such as
  `Person 6`, `person-6`, or `6`. The response includes `personResolution`
  with the resolved source-specific ID; unresolved requests include the
  available label/ID pairs.
- `mergeClipFacePeople({ clipId, sourcePersonId, targetPersonId })` combines a
  false identity split.
- `moveClipFaceAppearance({ clipId, sourcePersonId, targetPersonId,
  sourceTime })` moves one contiguous mistaken appearance.
- `assignClipFaceReviewCandidate({ clipId, candidateId, targetPersonId })`
  assigns a yellow review track to a confirmed person.

The compact Media-panel chat receives these definitions for hosted OpenAI,
Anthropic, and local Lemonade providers. Correction tools use IDs from the
latest `getClipFaceAnalysis` response, update the visible Analysis tab, and
persist the corrected frames in the project sidecar.

For a keep-only-person edit, chat filters the read by `personId`, treats the
returned appearances as keep ranges, merges overlaps, computes the complement
inside `timelineRange`, and exposes the result as `keepOnlyCutPlan` with a
ready-to-use `cutRangesFromClip` call. Chat passes that plan unchanged. The cut
tool performs its own splits end-to-start and cuts linked audio with the video;
chat must not pre-split the clip or delete its audio separately.

Download, model-load, worker, and inference failures are stored on the clip.
The read tool returns the exact module error with `success: false`, so the AI
can report it rather than claiming that no analysis exists.

## Performance

Video frames are sampled every 500 ms. Motion analysis keeps its existing
lower-resolution path; faces use an independent aspect-preserving frame whose
long edge is at most 640 pixels. Preprocessing and five-point alignment use
typed arrays rather than `OffscreenCanvas`, preserving the Linux/Mesa
main-thread fallback rules.

The portable WASM backend is expected to be slower than GPU inference,
especially when several faces require SFace inference in one sample. It is
chosen for dependable model startup and cancellation while the editor continues
to use WebGPU for rendering.

Faces smaller than 36 pixels in the 640-pixel analysis frame are intentionally
excluded from automatic identity grouping. They remain visible as yellow
Preview overlays and in the Analysis tab's **Needs review** gallery, because
title-card grids and background footage are too small for dependable anonymous
matching.

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

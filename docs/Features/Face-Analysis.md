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
combines source-time facts in one workspace. Its compact map aligns scenes,
cuts, speech, people, motion, focus, quality, audio, and text with the
playhead. Below it, one virtualized scene list shows larger speaker face crops,
word-synchronized dialogue, and scene time in compact scene blobs. Clicking a
blob expands the scene-scoped identity tools, facts, descriptions, quality
notices, and transcript in place.

Expanded scenes keep contextual People and Needs Review controls. Clicking a
person filters the virtualized scene list; **Next appearance** advances through
that identity's source-time appearances. Person identities and individual
appearance crops remain draggable correction sources. Dropping one onto another
person merges a false split or moves that appearance. Small yellow detections
that are unsafe to identify are consolidated into short visual tracks without
claiming an identity; their scene-scoped review crops can be clicked to seek or
dragged onto a confirmed person to assign the track manually. These previews
are resolved only for the bounded virtualized window and open scene, stay in a
bounded browser-memory cache, and are also persisted as versioned JPEGs under
`Cache/face-thumbnails` so they load without video seeks after a refresh or
project reopen.

Below the virtualized scene list, the complete detected-person strip restores
the correction surface for source-wide work: representative found-frame crops,
all appearances, person-to-person merge, appearance reassign, and review-track
assignment by drag and drop. It uses the same durable face correction services
as scene cards; no second people state is stored. Face crops are requested only
once their tile is near the viewport. Equal crop requests share the existing
pending/blob cache, so scrolling does not enqueue a fresh video seek for every
rendered card.

The top of the Analysis tab exposes separate action rows for **Focus & Motion**,
**Faces**, **Scene Cuts**, **Transcript**, and **AI Scenes**. Every row can be analyzed,
reanalyzed, retried, or cancelled without clearing the other results. A
metrics-only pass preserves compatible face observations. A face-only pass
reuses existing focus and motion samples; when no metrics exist yet, it creates
the inexpensive metrics baseline during the same source decode. At normal
Properties widths the actions form one compact three-column grid (with
responsive two- and one-column fallbacks). **Analyze All** creates a coalesced
job graph: repeated clicks observe the same run, compatible completed channels
are reused, Focus/Faces and the cut scan serialize on the shared source decoder,
and independent transcript work may proceed in parallel. AI scene descriptions
remain a separate opt-in action because they can incur provider cost and share
visual content externally.

Above those rows, compact **Scope** (`Source`, `Used Ranges`, `Selection`,
`In-Out`) and **Profile** (`Quick`, `Balanced`, `Deep`, `Custom`) controls show
uncached duration, cache reuse, known frame/sample work, relative cost, and a
benchmark-derived time range when one exists. **Quick** (1 fps) and
**Balanced** (2 fps) are execution settings for local Focus/Motion and Faces:
the runner receives the selected clipped source range and explicit sample
cadence. Used Ranges, Selection, and overlapping In/Out therefore analyze only
that honest source interval. Scene Cuts remain a frame-accurate, source-wide
160×90 scan; Transcript and AI Scene providers retain their existing semantics.

Face identities remain clip-range scoped. A whole-**Source** face pass is
explicitly unavailable rather than creating a second, incompatible identity
set; Focus/Motion can still use the complete source range. **Deep** and
**Custom** are blocked until matching qualifying real-media benchmark evidence
is available, so they never silently fall back to a denser or baseline pass.

Toggle **Face Ranges**
from the timeline's **View** menu or by right-clicking a face-analyzed video
clip; the switch is global and does not alter clip data.

Identity labels are local to one complete analysis pass. Re-analyzing a clip
may assign different numbers, and the labels do not identify real-world names.
The tracker uses SFace's calibrated cosine boundary plus a small transient set
of pose exemplars per identity, reducing false splits caused by lighting,
profile views, and partial occlusion. A tracker revision requires re-analysis;
the model files remain cached.

## Optional Active-Speaker Model Gate

The default active-speaker result remains the deterministic speaker/person fusion:
off-screen, one verified face, mouth-motion, or explicit `unknown`. An optional
local ROI model has no continuous-video mode. It can receive a bounded plan only
for source-time speech spans that the existing fusion has already marked
`unknown` with two or more visible people. The plan contains IDs, half-open time
ranges, A/V skew, and candidate rate only; raw frames, crops, embeddings, and
audio samples are ephemeral inference inputs and are never stored in the
project or returned to AI chat.

Before any model is promoted, its ONNX/local-runtime metadata must declare its
WebGPU, WASM, and CPU-fallback capabilities, license, and model-byte size. It
must beat the mouth-motion heuristic on labelled multi-person reference cases
and provide measured real-media cold and warm evidence for every required
platform/scenario: bounded-candidate runtime, peak memory, artifact size, and
actual download or observed no-download bytes; warm evidence must also prove
zero redundant source decode. Missing evidence, A/V skew or candidate-rate
requirements, unsupported runtime capability, or a continuous full-video run
keeps the model unpromoted and the result heuristic/`unknown`.

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

### Real-media benchmark evidence

The Phase-0A synthetic corpus validates only the benchmark schema; it never
unlocks a production analysis channel. To collect qualifying local evidence for
the existing `analysisBenchmarkGate`, use
`node scripts/agent-timeline/collect-real-media-benchmark.mjs --help` and pass
an explicitly selected licensed media file, its measured source duration, a
scenario ID, profile, and a registered **local-only** dev-bridge benchmark
runner. The collector records cold and warm runs for cuts, focus/motion, faces,
and audio separately. It fingerprints the selected file without saving its
path, requires the browser runner to confirm cache state and that it did not
use the network/cloud, and captures the measured elapsed ratio, device/platform
metadata, artifact bytes, peak memory when exposed, and warm redundant decode
seconds.

Clear only local analyzer/model/artifact caches before a cold pass, reopen the
same project, and wait five seconds after that reload. Do not clear caches
between the warm primer and warm measurement. Missing memory/artifact/decode
observations are retained as `null` and make the report non-qualifying rather
than being replaced by zero. The collector does not register or invoke a
production runner itself; that connection remains deliberately explicit so it
cannot trigger paid/cloud analysis by accident.

The explicitly registered local runner receives `{ pass: "baseline" | "analysis",
localOnly: true, mediaPath, mediaFingerprint, durationSeconds, scenarioId,
profile, analyzer, cacheState }` through the normal authenticated dev bridge.
It returns `agent-timeline-real-media-benchmark/v1` with
`kind: "agent-timeline-local-analysis-pass"`, `networkUsed: false`,
`cloudUsed: false`, its confirmed cache state/reset flag, exact channel set,
platform/device class, elapsed milliseconds, and any observable peak-memory,
artifact-byte, and redundant-decode values. This deliberate runner boundary is
what lets a real browser implementation measure its existing local cut,
focus/motion, face, and audio paths without adding a second hidden analyzer.

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
Preview overlays and as scene-scoped **Needs review** crops in the Analysis
workspace, because title-card grids and background footage are too small for
dependable anonymous matching.

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

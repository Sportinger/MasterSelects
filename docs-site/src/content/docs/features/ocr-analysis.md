---
title: "Optional local OCR analysis"
---

OCR currently consists of client-side Agent Timeline contracts and a tested, dependency-injected local pipeline; it is not wired into the production analysis job, a concrete OCR worker, package downloader, cache, or Analysis workspace input. The Agent Timeline nevertheless has a separately queryable `text` channel and accepts persisted `onscreen-text` events. The pipeline never uploads frames: an injected worker receives a transient frame lease, returns recognized regions, and the lease is released before the result is returned.

Candidate selection currently produces:

- one representative keyframe per shot;
- extra candidates only from caller-supplied image-hash or text-region change signals;
- no decoding or OCR-resolution policy in the selector;
- source-time half-open intervals ending at the next candidate or shot boundary.

The caller can cap extra candidates per shot, but the selector default is unbounded. Profile estimates list zero text keyframes for Quick, one for Balanced, and three for Deep.

Recognized text is Unicode-normalized, whitespace-collapsed and deduplicated only across adjacent sampled intervals. The pipeline produces an `onscreen-text` event with normalized/original text, confidence, optional normalized box, language, rule-based kind, keyframe time, analyzer/model provenance, and a half-open visibility span. Raw frame pixels, `Blob`s, `ImageBitmap`s, `VideoFrame`s and Base64 data are not result or manifest fields.

Language-package metadata records package ID/version/size/state and local-bundled or local-download provenance. A `download-required` state prevents the pipeline from running.

## Profile and benchmark gate

Quick is disabled by the decision layer. Balanced and Deep are enabled only when a caller supplies a matching real-media benchmark policy and measurements for the `text` channel. The gate requires required platform/scenario cold and warm evidence, the profile runtime budget, memory limit, artifact-size-per-minute limit and no redundant warm-cache decode. An explicit Deep choice does not bypass the gate. The decision layer additionally rejects missing/unavailable packages and downloads exceeding the configured limit.

The cache-key helper hashes source identity, profile, analyzer and model IDs/versions, normalized language set, and candidate metadata/hash signals. It intentionally excludes raw decoded frames.

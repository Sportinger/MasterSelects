# Optional local OCR analysis

OCR is a separately gated `text` channel for the Agent Timeline. It is not part of a normal frame scan and it never uploads frames: a dependency-injected local worker receives a transient frame lease, returns recognized regions, and the lease is released before durable data is returned or cached.

Candidate selection is deliberately bounded:

- one representative keyframe per shot;
- extra candidates only from an existing image-hash or text-region change signal;
- no 160×90 OCR and no OCR-on-every-frame path;
- each candidate represents a source-time half-open interval ending at the next candidate or shot boundary.

Recognized text is Unicode-normalized, whitespace-collapsed and deduplicated only across adjacent sampled intervals. The persisted result is an `onscreen-text` event with normalized/original text, confidence, optional normalized box, language, rule-based kind, keyframe time, analyzer/model provenance, and a half-open visibility span. Raw frame pixels, `Blob`s, `ImageBitmap`s, `VideoFrame`s and Base64 data are not result, manifest, shard or cache fields.

Language packages report package ID/version/size/state and are bundled or downloaded into a local offline cache only. A `download-required` state is a transparent blocked-to-run condition; this architecture does not implement a downloader or a cloud OCR fallback.

## Profile and benchmark gate

Quick remains disabled. Balanced and Deep are enabled only after a matching
real-media benchmark gate passes for the `text` channel, including required
platform/scenario cold and warm evidence, the profile runtime budget, memory
limit, artifact-size-per-minute limit and no redundant warm-cache decode. An
explicit Deep choice does not bypass the expensive-analysis gate. The OCR
decision layer additionally rejects missing/unavailable packages and downloads
exceeding the configured limit.

No OCR engine or benchmark data is bundled by this change. Therefore the
honest default state is `unavailable` (no local worker) or `blocked` (no
qualifying profile evidence), never a claim that OCR has been benchmarked.

The cache key hashes source identity, profile, analyzer and model IDs/versions, normalized language set, and candidate metadata/hash signals. It intentionally excludes raw decoded frames.

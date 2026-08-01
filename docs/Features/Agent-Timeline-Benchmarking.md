# Agent Timeline local-media benchmark runner

`runAgentTimelineLocalBenchmark` is a development-bridge-only tool for
`scripts/agent-timeline/collect-real-media-benchmark.mjs`. It is deliberately
absent from the normal AI/chat tool registry. Invoke it through the usual
authenticated `/api/ai-tools` bridge; the collector can select a fresh tab
automatically or target one explicitly with `--target-tab-id`, and standard
bridge tab isolation applies unchanged.

The runner accepts the collector's local baseline/analysis request schema and
the separate `{ "cancel": true }` request.
It never reads the supplied path from browser JavaScript. Instead, it requires
exactly one selected local Media panel item whose browser `File` name and size
match the supplied local fingerprint. Visual/audio passes additionally require
one matching timeline clip. The SHA-256 remains collector evidence and is not
recomputed or trusted as browser-local file access.

Supported local adapters are scene cuts, ClipAnalyzer metrics (focus/motion),
ClipAnalyzer faces, and the existing local audio-level analyzer. They do not
invoke transcription, scene descriptions, cloud APIs, or network-backed model
providers. A second request with `{ "cancel": true }` asks supported active
local analyzers to cancel; audio decoding has no cancellable adapter and is
reported without a fabricated cancellation claim.

The runner has two separate contracts: a `baseline` pass and an `analysis`
pass. Both echo the requested `baselineKind` (`standalone-cut` or
`proxy-piggyback`), and the collector rejects a result whose pass, baseline
kind, platform, device class, or renderer/backend evidence differs from its
paired result. The current browser adapter can execute a standalone-cut
baseline, but it is a completed measurement only when its requested
cache state is verified and an explicit local instrumentation capability is
registered; proxy-piggyback has no instrumented adapter. This repository
defines those capability hooks but does not register them, so the browser
runner cannot emit a qualifying real-media measurement.

Peak memory, durable artifact bytes, redundant decoded seconds, and optional
renderer/backend/software-fallback evidence are injected only by a local
instrumentation capability that observed that exact pass. The runner never
substitutes zero. Without the capability it fails closed as unavailable, so the
collector cannot produce a qualifying performance claim.

Cold reset is not asserted from an empty UI state. A registered local verifier
must directly confirm analyzer/model/artifact reset before a cold pass runs.
Warm cache is only labelled `warm` when matching local output is visible and
the pass reports measured `redundantDecodedSeconds: 0`; absent or non-zero
decoder evidence is blocked. Linux/Mesa policies can require observable
platform class, Mesa state, renderer backend, and software-canvas fallback.

`npm run agent-timeline:benchmark` also runs the separate deterministic
synthetic benchmark. Its reports validate benchmark contracts only;
they never qualify for the production analysis benchmark gate.

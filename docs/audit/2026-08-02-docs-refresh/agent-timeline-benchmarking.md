# Agent-Timeline-Benchmarking.md — audit 2026-08-02

## Verified (spot checks that held)

- `runAgentTimelineLocalBenchmark` is dev-bridge-only and bypasses the ordinary `AI_TOOLS` dispatch: `src/services/aiTools/devBridge/browser/client.ts` imports it and handles it before `executeAITool`; `src/services/agentTimeline/benchmark/localBenchmarkRunner/contracts.ts` defines the tool name.
- The local request schema, analyzers (`cuts`, `focus-motion`, `faces`, `audio`), pass names, baseline kinds, and local-only/cloud/network result flags match `src/services/agentTimeline/benchmark/localBenchmarkRunner/contracts.ts` and `localBenchmarkRunner.ts`.
- Browser binding matches one selected media item by browser `File` name and size, does not read `mediaPath`, and requires exactly one timeline clip for every analyzer other than cuts: `src/services/agentTimeline/benchmark/localBenchmarkRunner/browserLocalBenchmarkRunner.ts`.
- The adapter uses scene-cut analysis, `analyzeClip` metrics/faces, and `audioAnalyzer.analyzeLevels`; it has no audio cancellation primitive: `src/services/agentTimeline/benchmark/localBenchmarkRunner/browserLocalBenchmarkRunner.ts`.
- Cold-reset and warm-cache evidence fail closed, and warm completion requires measured `redundantDecodedSeconds === 0`: `src/services/agentTimeline/benchmark/localBenchmarkRunner/localBenchmarkRunner.ts`; paired real-media evidence also requires matching platform, device, and runtime evidence: `scripts/agent-timeline/realMediaBenchmark.mjs`.
- Proxy-piggyback is unavailable in the browser adapter; standalone-cut is the only implemented baseline path: `src/services/agentTimeline/benchmark/localBenchmarkRunner/browserLocalBenchmarkRunner.ts`.

## Outdated or wrong (claim → reality, with file evidence)

- “Invoke it … with the collector's explicit target tab” → `--target-tab-id` is optional. The collector otherwise selects a fresh connected tab, preferring visible/focused tabs. Evidence: `scripts/agent-timeline/collect-real-media-benchmark.mjs` (`selectTarget`, `--target-tab-id` parsing).
- “The runner accepts only the collector's local baseline/analysis request schema” → it also accepts `{ "cancel": true }` before schema parsing. Evidence: `src/services/agentTimeline/benchmark/localBenchmarkRunner/browserLocalBenchmarkRunner.ts` (`runAgentTimelineLocalBenchmark`).
- “Standalone-cut … becomes a completed measurement only after … instrumentation capability is registered” → cold requests are additionally blocked until a reset verifier confirms the requested cache state. Evidence: `src/services/agentTimeline/benchmark/localBenchmarkRunner/localBenchmarkRunner.ts` and `browserLocalBenchmarkRunner.ts`.
- The doc did not state the current operational status: capability hooks are defined but are not registered anywhere in this repository, so cold runs block and otherwise completed analyzer passes are unavailable without pass observability. Evidence: `src/services/agentTimeline/benchmark/localBenchmarkRunner/browserLocalBenchmarkRunner.ts` defines `configureAgentTimelineLocalBenchmarkCapabilities`, while repository search finds no invocation; the same file returns “No registered verifier…” and “No local pass-observability capability…”.

## Noteworthy / unusual

- The shipped `npm run agent-timeline:benchmark` command runs a separate deterministic synthetic Phase-0A runner (`scripts/agent-timeline/run-benchmark.mjs`, `benchmarkCore.mjs`). Its reports explicitly set `qualifying: false` and provide no gate measurements, while real-media evidence can be converted to the production-gate DTO in `scripts/agent-timeline/realMediaBenchmark.mjs`.
- `collect-real-media-benchmark.mjs` labels `--baseline-kind` as “Required” in its help, but the parser supplies `standalone-cut` by default and does not require that flag. This is a collector-help inconsistency outside the audited feature document.
- The documentation's Linux/Mesa wording is policy-oriented: the local benchmark contracts can carry `platformClass`, `mesa`, renderer, backend, and canvas-path evidence, but no current capability hook is registered to collect it. Evidence: `contracts.ts` and `browserLocalBenchmarkRunner.ts`.

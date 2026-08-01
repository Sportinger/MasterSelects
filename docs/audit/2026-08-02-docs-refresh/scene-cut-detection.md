# Scene-Cut-Detection.md — audit 2026-08-02

## Verified (spot checks that held)

- Proxy generation analyzes every decoded `VideoFrame` before proxy-frame deduplication; `PROXY_FPS` is 30. Evidence: `src/services/proxyGenerator.ts`, `src/services/proxyGeneration/constants.ts`.
- Scene-cut-only runs use the same generator with `analyzeSceneCuts` and `sceneCutsOnly`, and do not write proxy frames. Evidence: `src/stores/mediaStore/slices/proxy/sceneCutActions.ts`, `src/services/proxyGenerator.ts`.
- The persisted `SceneCutAnalysis` contains schema/detector versions, 160x90 dimensions, decoded and expected source-frame counts, source fingerprint, cuts, and completion time. Evidence: `src/types/sceneCutAnalysis.ts`, `src/services/project/projectMediaSerialization.ts`.
- Cache validity checks schema, detector version, dimensions, exact decoded/expected frame-count equality, and—when a source is available—size and last-modified time. Evidence: `src/services/sceneCutDetection/sceneCutDetector.ts`, `src/services/project/load/loadMediaHydration.ts`.
- The detector implements Y/Cb/Cr pixel and histogram metrics, changed-pixel ratio, one-pixel edge tolerance, translation search up to eight pixels, and a two-second adaptive history. Evidence: `src/services/sceneCutDetection/sceneCutDetector.ts`.
- The one-frame candidate confirmation suppresses isolated flashes and omits a final unconfirmed candidate. Evidence: `src/services/sceneCutDetection/sceneCutDetector.ts`.
- Scene-cut markers exclude audio clips and cuts outside the current source in/out interval, account for reversed clips, and use the same painter in worker and main-thread timeline paths. Evidence: `src/components/timeline/utils/timelineClipCanvasPassiveDecorations.ts`, `src/components/timeline/utils/timelineClipCanvasSceneCutPainter.ts`, `src/components/timeline/workers/timelineClipCanvasWorkerPassivePainter.ts`, `src/components/timeline/utils/timelineClipCanvasMainThreadDraw.ts`.

## Outdated or wrong (claim → reality, with file evidence)

- “On non-Linux platforms” the dedicated worker is used → worker use also requires both `Worker` and `OffscreenCanvas`; otherwise the main-thread software analyzer is selected. Evidence: `src/services/sceneCutDetection/proxySceneCutAnalyzer.ts`, `src/utils/canvasPlatform.ts`.
- The Properties Analysis “summary” shows the visible-clip count and source total on hover → the current action bar has a **Cuts** pill whose ready status is the source-wide `${cuts.length} cuts`; no visible-range count or hover-total implementation was found. Evidence: `src/components/panels/properties/AnalysisTab.tsx`, `src/components/panels/properties/AnalysisActionCenter.tsx`.
- The top action area has “four channels” in a “two-column action grid” → it is a wrapping action bar with six actions: Focus & motion, Faces, Cuts, Transcript, Audio intelligence, and AI Scenes. The two-column grid is only for expanded advanced controls. Evidence: `src/components/panels/properties/AnalysisActionCenter.tsx`, `src/components/panels/properties/AnalysisActionCenter.css`, `src/components/panels/properties/AnalysisTab.tsx`.
- “Analyze All runs the video-heavy pipelines sequentially” → the job graph serializes jobs only when their resource locks conflict; visual analysis and cuts share `source-decode`, while transcript and audio have independent locks. Analyze All does not include AI Scenes unless explicitly requested by a caller. Evidence: `src/services/agentTimeline/jobs/currentClipAnalysisExecution.ts`, `src/services/agentTimeline/jobs/analysisJobGraph.ts`.
- “Gradual fades and dissolves are not reported as hard cuts” → no transition classifier or explicit fade/dissolve rejection exists; this is a frame-to-frame threshold detector, and a transition that crosses its thresholds can be emitted. There is no separate windowed transition detector. Evidence: `src/services/sceneCutDetection/sceneCutDetector.ts`.

## Noteworthy / unusual

- Standalone scene-cut scans and proxy generation share the `currentlyGeneratingProxyId`/proxy-job registry, so another proxy or scene-cut job prevents a new scan from starting even though proxy readiness and cut-cache state are stored separately. Evidence: `src/stores/mediaStore/slices/proxy/sceneCutActions.ts`, `src/stores/mediaStore/slices/proxySlice.ts`.
- The source-wide cut cache is preserved in project metadata even when hydration marks it non-current; the analysis is cloned into the media record while status becomes `none`. Evidence: `src/services/project/load/loadMediaHydration.ts`.
- The visible **Cuts** detail string in the Analysis tab contains mojibake (`160Ç-90`) despite the implemented 160x90 scan and the feature documentation using `160x90`. Evidence: `src/components/panels/properties/AnalysisTab.tsx`, `src/types/sceneCutAnalysis.ts`.

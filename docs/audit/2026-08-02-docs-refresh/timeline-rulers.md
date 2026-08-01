# Timeline-Rulers.md — audit 2026-08-02

## Verified (spot checks that held)

- The ruler is DOM-based, viewport-windowed and DPR-aligned: `src/components/timeline/TimelineRuler.tsx` renders `.ruler-lane` rows and calculates a visible range with overscan.
- Ruler state is persisted through runtime serialization and project save/load: `src/stores/timeline/serialization/serializableTimelineState.ts`, `src/stores/timeline/serializationUtils.ts`, `src/services/project/projectSave.ts`, and `src/services/project/load/loadTimelineHydration.ts` all carry `tempoMap`, `rulerLanes`, and `activeRulerLaneId`.
- Lane formats are unique, ids are deterministic, and lane toggles/active selection are excluded from history: `src/stores/timeline/rulerSlice.ts` and `src/timeline/tempo/rulerDefaults.ts`.
- Time, timecode, frames and bars have separate tick generation, while the legacy linear body-grid plan remains: `src/components/timeline/utils/timelineGrid.ts`.
- The documented click-versus-scrub threshold and active-lane highlight are present: `src/components/timeline/TimelineRuler.tsx` and `src/components/timeline/Timeline.css`.
- The piano roll uses the shared TempoMap/tick-generator foundation rather than `TimelineRuler.tsx`: `src/components/pianoRoll/pianoRollGrid.ts` and `src/components/pianoRoll/PianoRollRuler.tsx`.

## Outdated or wrong (claim → reality, with file evidence)

- “a single 30px row,” “no timecode lane,” and the pre-lane `displayMode` description → the current ruler renders multiple lanes; Timecode is a lane; ruler `displayMode` plumbing is gone. Evidence: `src/components/timeline/TimelineRuler.tsx`, `src/components/timeline/RulerLanesMenu.tsx`, `src/components/timeline/components/TimelineRulerHeaderChrome.tsx`.
- “TempoMap … constant 4/4 @ 60 BPM today” / “One segment now; N segments later” → the default is 4/4 @ 60 BPM, but the live model supports sorted editable events, time signatures, `jump`/`ramp` curves, and multiple segments. Evidence: `src/types/timeline.ts`, `src/timeline/tempo/tempoEdits.ts`, `src/timeline/tempo/TempoMap.ts`, `src/stores/timeline/tempoSlice.ts`.
- The lane list is described as only Time / Timecode / Frames / Bars+Beats → it also includes Tempo. The Tempo row is an editor, not a tick lane and cannot be selected active. Evidence: `src/types/timeline.ts`, `src/components/timeline/RulerLanesMenu.tsx`, `src/components/timeline/TimelineRuler.tsx`, `src/components/timeline/components/TempoRulerLane.tsx`.
- “no grid snapping,” and active lane as the future snap seam → enabled Bars+Beats draws the TempoMap grid and activates snapping to its visible subdivision; `activeRulerLaneId` now only controls the lane highlight. Evidence: `src/timeline/tempo/barsGrid.ts`, `src/components/timeline/components/TimelineTrackGridCanvas.tsx`, `src/stores/timeline/positioningUtils.ts`, `src/stores/timeline/rulerSlice.ts`.
- `ProjectComposition` has “no tempo, no time signature” → it has optional `tempoMap`, `rulerLanes`, and `activeRulerLaneId`, normalized for older projects. Evidence: `src/services/project/types/composition.types.ts`, `src/services/project/projectSave.ts`, `src/services/project/load/loadTimelineHydration.ts`.
- `historyStore` omits all new ruler fields and says tempo must opt in only when editing lands → tempo edits landed and `tempoMap` participates in capture/apply/undo; only lanes and active selection remain view state. Evidence: `src/stores/historyStore/snapshotCapture.ts`, `src/stores/historyStore/snapshotApply.ts`, `src/stores/historyStore/historyStoreTypes.ts`, `src/stores/timeline/tempoSlice.ts`.
- Packet 5’s menu tool list omits Tempo and grid resolution → the menu has a Tempo option plus Bar, Beat, 1/8, 1/16 and triplet grid settings under Bars+Beats. Evidence: `src/components/timeline/RulerLanesMenu.tsx`, `src/timeline/tempo/barsGrid.ts`.
- Packet 4 names `TimelineTrackGridCanvas` without its actual `components/` path → the component is `src/components/timeline/components/TimelineTrackGridCanvas.tsx`.

## Noteworthy / unusual

- `src/stores/timeline/rulerSlice.ts` still contains a stale comment that tempo-map editing is future work and must opt into history, although the current history files do include `tempoMap`.
- `docs/Features/Timeline.md` still says the active lane is the “future snap target,” contradicting the current Bars+Beats-enabled snapping implementation. It was not edited because this audit is limited to two files.
- `docs/completed/features/MIDI-Tracks-Plan.md` still describes piano-roll snapping as out of scope. That is a separate piano-roll claim; main-timeline grid snapping is implemented.
- `TempoRulerLane.tsx` portals its context menu to `document.body` because transformed and overflow-hidden ruler wrappers would otherwise clip fixed-position UI; this is intentional but a fragile layout dependency.

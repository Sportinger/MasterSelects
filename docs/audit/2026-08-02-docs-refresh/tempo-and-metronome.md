# Tempo-And-Metronome.md — audit 2026-08-02

## Verified (spot checks that held)

- The editable tempo map, edit invariants, musical re-anchoring, and MIDI remapping are implemented at `src/timeline/tempo/TempoMap.ts`, `src/timeline/tempo/tempoEdits.ts`, `src/timeline/tempo/tempoRemap.ts`, and `src/stores/timeline/tempoSlice.ts`.
- Tempo events support the documented `jump`/`ramp` model; ramp integration is quadratic in time and its inverse solves the quadratic in `src/timeline/tempo/TempoMap.ts`.
- The documented tempo-lane actions, project-tempo restrictions, bar snapping, Alt free placement, and ramp indicator are implemented in `src/components/timeline/components/TempoRulerLane.tsx`.
- Bars + Beats drives the body grid and both clipping/tool interaction snap paths through `src/timeline/tempo/barsGrid.ts`, `src/stores/timeline/positioningUtils.ts`, and `src/components/timeline/tools/pointer/timelineToolPointerDispatcher.ts`.
- The metronome UI, localStorage preferences, look-ahead scheduler, direct-to-destination routing, export guard, and synthesized click voice are present in `src/components/timeline/MetronomeButton.tsx`, `src/stores/timeline/viewPreferences.ts`, `src/services/audio/metronomeScheduler.ts`, and `src/engine/audio/metronomeVoice.ts`.
- Tempo map, ruler lanes, and active ruler lane persist with a composition in `src/stores/timeline/serialization/serializableTimelineState.ts` and `src/services/project/projectSave.ts`; only `tempoMap` participates in history, as shown by `src/stores/historyStore/historyStoreTypes.ts`.

## Outdated or wrong (claim → reality, with file evidence)

- “a lane under Bars + Beats” → Tempo is independently toggled. The canonical stack places it below Bars + Beats only when both lanes are enabled; it can be shown without Bars + Beats. Evidence: `src/components/timeline/RulerLanesMenu.tsx`, `src/stores/timeline/rulerSlice.ts`.
- “the four CC automation lanes” → The remapper handles four MIDI automation lanes: `cutoff`, `mod`, `expression`, and `pitchBend`; pitch bend is not a CC lane. Evidence: `src/timeline/tempo/tempoRemap.ts`.

## Noteworthy / unusual

- The piano roll has more than the documented read-only tempo flags: its Time/Bars rulers and bar/beat/subdivision grid all use the shared tempo map. Evidence: `src/components/pianoRoll/PianoRoll.tsx`, `src/components/pianoRoll/PianoRollRuler.tsx`, `src/components/pianoRoll/pianoRollGrid.ts`.
- `activeRulerLaneId` is persisted per composition but deliberately excluded from undo history; the Tempo lane cannot become active because it is an editor rather than a timebase. Evidence: `src/stores/timeline/rulerSlice.ts`, `src/stores/historyStore/historyStoreTypes.ts`.
- The source comments retain several stale “future tempo/meter edits” references even though editing is shipped, notably `src/timeline/tempo/TempoMap.ts`; these are code-comment drift, not runtime status.

# Timeline.md — audit 2026-08-02

## Verified (spot checks that held)

- The default `Video 2`, `Video 1`, and `Audio` layout, the 20–600 px track-height clamp, and the 80–600 px curve-editor clamp match `src/stores/timeline/constants.ts` and `src/stores/timeline/trackSlice.ts`.
- Track parenting actions and cycle handling are present: `setTrackParent()` and `getTrackChildren()` are implemented in `src/stores/timeline/trackSlice.ts` and typed in `src/stores/timeline/storeTypes/trackActionTypes.ts`.
- Canvas/chrome responsibilities and MIDI colour handling match `src/components/timeline/TimelineClipCanvas.tsx`, `src/components/timeline/utils/timelineClipCanvasChromeOverlays.ts`, `src/components/timeline/trackColor.ts`, `src/styles/tokens.css`, and `src/components/timeline/TimelineTracks.css`.
- Video bake, audio-region editing and baking, vector animation, motion shapes, nested compositions (depth 8), transitions, parenting, source placement, and timeline operation-kernel paths have corresponding implementations under `src/stores/timeline/`, `src/components/timeline/`, `src/timeline/`, and `src/transitions/`.
- The documented transition suite is present in `src/transitions/crossfade/`, `src/transitions/dipToBlack/`, `src/transitions/dipToWhite/`, `src/transitions/wipeLeft/`, and `src/transitions/wipeRight/`.
- `timelineSessionId` is initialized in `src/stores/timeline/index.ts` and advanced during serialization reload handling in `src/stores/timeline/serializationUtils.ts`.

## Outdated or wrong (claim → reality, with file evidence)

- “Video or audio track” → `addTrack()` also creates MIDI tracks. Evidence: `src/stores/timeline/storeTypes/trackActionTypes.ts`, `src/stores/timeline/trackSlice.ts`.
- The clip-type and video-track lists omitted shipped MIDI, caption, storyboard, math-scene, and light workflows. Evidence: `src/stores/timeline/index.ts`, `src/stores/timeline/midiClipSlice.ts`, `captionClipSlice.ts`, `storyboardClipSlice.ts`, `mathSceneClipSlice.ts`, and `lightClipSlice.ts`.
- “Planned tools are visible but disabled until their operation-kernel migration exists” → the tool registry has no `future` entries. The source-dependent placement commands use `requires-source`; Glue and MIDI Pencil are enabled and were omitted. Evidence: `src/components/timeline/tools/registry/timelineToolDefinitions.ts`.
- The track-header menu list omitted `Add MIDI Track`; MIDI mute/solo and instrument controls were also omitted. Evidence: `src/components/timeline/utils/trackContextMenu.ts`, `src/components/timeline/TimelineHeader.tsx`, and `src/components/timeline/components/TimelineHeaderAudioControls.tsx`.
- `TimelineClipCanvas.tsx` was said to render labels → it creates DOM chrome overlays for titles, icons, and badges; the canvas renders passive bodies/previews. Evidence: `src/components/timeline/TimelineClipCanvas.tsx`, `src/components/timeline/utils/timelineClipCanvasChromeOverlays.ts`.
- The store-slice inventory omitted `captionClipSlice`, `storyboardClipSlice`, `midiClipSlice`, `lightClipSlice`, `stemSeparationSlice`, `rulerSlice`, and `tempoSlice`. Evidence: `src/stores/timeline/index.ts`.
- The document omitted audio record-arm, transport recording, and punch-range display. Evidence: `src/components/timeline/TimelineControls.tsx`, `src/components/timeline/components/TimelineHeaderAudioControls.tsx`, and `src/components/timeline/components/TimelineOverlays.tsx`.

## Noteworthy / unusual

- `TimelineSourceType` is broader than the feature document’s original clip list, and caption clips are represented as text-source clips with `captionProperties`, not a separate `caption` source type. Evidence: `src/types/timeline.ts` and `src/stores/timeline/captionClipSlice.ts`.
- MIDI tracks are intentionally in the audio layout/solo domain but external media drops explicitly reject MIDI tracks. Evidence: `src/components/timeline/utils/trackSection.ts`, `src/components/timeline/hooks/useExternalDrop.ts`, and `src/components/timeline/TimelineHeader.tsx`.
- The client contains a shipped stem-separation slice and clip controls that the Timeline feature page still does not describe in detail. Evidence: `src/stores/timeline/stemSeparationSlice.ts` and `src/components/timeline/interactionShell/ClipStemControls.tsx`.

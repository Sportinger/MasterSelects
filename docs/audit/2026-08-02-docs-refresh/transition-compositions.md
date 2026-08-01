# Transition-Compositions.md — audit 2026-08-02

## Verified (spot checks that held)

- `package.json` declares version `2.4.4`.
- The transition registry registers 74 runtime-enabled definitions before adding 20 `plannedTransitions`; `src/transitions/types.ts` excludes planned definitions from runtime, preview, and export by default.
- `src/services/timeline/transitionCompositionRecipeTemplate.ts` uses template version 4, while `src/services/timeline/transitionCompositionLightLeakTemplate.ts` uses version 3 and builds the outgoing source, masked incoming source, and light-streak overlay separately.
- `src/types/timelineCore.ts` and `src/services/timeline/transitionSourceMap.ts` define mapped-v3 and `TransitionSourceMap` v2; `src/services/compositionRender/transitionMappedAnimation.ts` resolves parent animation separately from composition-local generated animation and fails closed on invalid v2 data.
- Preview and export create a non-persistent mapped transition composition when no linked composition exists (`src/services/layerBuilder/layerBuilderTransitionComposition.ts`, `src/engine/export/layerBuilder/nestedLayers.ts`). The transition overlay opens the composition on double-click (`src/components/timeline/components/TransitionOverlays.tsx`).
- Legacy upgrades are explicitly confirmed, run in one history batch, retain a hidden transition-composition backup, and fall back to opening the legacy composition when upgrade does not complete (`src/components/timeline/hooks/useTransitionCompositionOpen.ts`, `src/services/timeline/transitionCompositionService.ts`, `src/stores/mediaStore/slices/composition/crudActions.ts`).
- `getStats`, `getStatsHistory`, and `getPlaybackTrace` are registered AI bridge tools (`src/services/aiTools/handlers/index.ts`, `src/services/aiTools/policy/registry.ts`).

## Outdated or wrong (claim → reality, with file evidence)

- “A mapped-v3 composition has exactly one full-duration outgoing source clip and one full-duration incoming source clip” and the troubleshooting equivalent → this is true for ordinary templates, but not for multi-panel templates. `expandMultiPanelClips` replaces the source clip with full-duration panel clips whose IDs extend the linked source ID; Magnetic Tiles, Puzzle Push, and Shatter Glass use `multi-panel` recipes. Evidence: `src/services/timeline/transitionCompositionRecipeTemplate.ts`, `src/services/layerBuilder/transitionMultiPanelLayers.ts`, `src/transitions/magneticTiles/index.ts`, `src/transitions/puzzlePush/index.ts`, `src/transitions/shatterGlass/index.ts`.

## Noteworthy / unusual

- The explicit legacy-upgrade validator requires an exact linked source ID, but multi-panel generation only emits suffixed panel IDs. As a result, `upgradeLegacyTransitionCompositionForPair` returns `null` for those generated layouts and the UI reopens the legacy composition. Normal generation and reuse deliberately accept the suffixed IDs through `isLinkedSourceClipId`. Evidence: `src/services/timeline/transitionCompositionService.ts`, `src/services/timeline/transitionCompositionRecipeTemplate.ts`, `src/services/timeline/transitionCompositionReuse.ts`.
- Transition compositions are intentionally hidden from the user-visible composition list, and deletion traverses `legacyBackupCompositionId` plus linked transition descendants. Evidence: `src/stores/mediaStore/compositionVisibility.ts`, `src/stores/mediaStore/slices/composition/crudActions.ts`.
- Nested-composition frame caching is disabled whenever a renderable nested layer has a video, video element, WebCodecs player, runtime source, native decoder, or nested composition, so dynamic transition media is recollected rather than reusing a same-time texture. Evidence: `src/engine/render/NestedCompRenderer.ts`.

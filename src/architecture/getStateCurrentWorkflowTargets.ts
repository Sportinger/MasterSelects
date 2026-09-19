export const currentWorkflowGetStateHardTargets = [
  // Release 3.1.3 added imperative UI event handlers and cross-store tracking,
  // terrain, annotation, and camera-output workflows. These reads must observe
  // state at action time to avoid stale React closures or partial transactions.
  // They remain exact hard targets instead of adapter exemptions so every new
  // call site still requires an explicit review and a matching cap change.
  { path: 'src/App.tsx', maxCurrentHits: 1 },
  { path: 'src/components/common/EditorPlaybackRuntimeHost.tsx', maxCurrentHits: 1 },
  { path: 'src/components/dock/useMobilePreviewLayoutFit.ts', maxCurrentHits: 1 },
  { path: 'src/components/export/runners/hapExportRunner.ts', maxCurrentHits: 1 },
  { path: 'src/components/panels/annotations/AnnotationsPanel.tsx', maxCurrentHits: 1 },
  { path: 'src/components/panels/color-workspace/ColorClipStrip.tsx', maxCurrentHits: 12 },
  { path: 'src/components/panels/color-workspace/ColorWorkspaceTopBar.tsx', maxCurrentHits: 2 },
  { path: 'src/components/panels/media/panel/useMediaPanelTouchTimelineDrag.ts', maxCurrentHits: 2 },
  { path: 'src/components/panels/media/panel/useMediaPanelTrackingAssets.ts', maxCurrentHits: 6 },
  { path: 'src/components/panels/media/TrackingAssetActions.tsx', maxCurrentHits: 1 },
  { path: 'src/components/panels/properties/DatamoshBakeSection.tsx', maxCurrentHits: 1 },
  { path: 'src/components/panels/properties/surfaceTracking/DenseTerrainControls.tsx', maxCurrentHits: 1 },
  { path: 'src/components/panels/properties/surfaceTracking/LegacySurfaceTrackingTab.tsx', maxCurrentHits: 5 },
  { path: 'src/components/panels/properties/surfaceTracking/SurfaceTrackingTab.tsx', maxCurrentHits: 1 },
  { path: 'src/components/panels/properties/surfaceTracking/TerrainAttachmentControls.tsx', maxCurrentHits: 6 },
  { path: 'src/components/panels/properties/surfaceTracking/TerrainTrackingControls.tsx', maxCurrentHits: 1 },
  { path: 'src/components/panels/properties/surfaceTracking/TrackingAttachPicker.tsx', maxCurrentHits: 3 },
  { path: 'src/components/panels/properties/surfaceTracking/TrackingConnectionControls.tsx', maxCurrentHits: 11 },
  { path: 'src/components/panels/properties/surfaceTracking/useTrackingAssetActions.ts', maxCurrentHits: 11 },
  { path: 'src/components/panels/properties/surfaceTracking/useTrackingWorkspace.ts', maxCurrentHits: 8 },
  { path: 'src/components/preview/PreviewFpsTouchControls.tsx', maxCurrentHits: 2 },
  { path: 'src/components/preview/tracking/TrackingPreviewOverlay.tsx', maxCurrentHits: 1 },
  { path: 'src/components/preview/useMaskBoundsResize.ts', maxCurrentHits: 1 },
  { path: 'src/components/preview/usePreviewMouseRouting.ts', maxCurrentHits: 3 },
  { path: 'src/components/preview/usePreviewSceneNavigation.ts', maxCurrentHits: 1 },
  { path: 'src/components/preview/usePreview3DMediaDrop.ts', maxCurrentHits: 10 },
  { path: 'src/components/timeline/ClipOriginContextMenuItem.tsx', maxCurrentHits: 1 },
  { path: 'src/components/timeline/components/TimelineSectionHeaderRow.tsx', maxCurrentHits: 5 },
  { path: 'src/components/timeline/hooks/useRulerAnnotations.ts', maxCurrentHits: 3 },
  { path: 'src/components/timeline/utils/clipDragKeyframeDisclosure.ts', maxCurrentHits: 2 },
  { path: 'src/services/colorGrades/remoteColorGradeCommands.ts', maxCurrentHits: 9 },
  { path: 'src/services/liveStream/localRecorder.ts', maxCurrentHits: 1 },
  { path: 'src/services/liveStream/streamSession.ts', maxCurrentHits: 5 },
  { path: 'src/services/liveStream/__tests__/streamStore.test.ts', maxCurrentHits: 18 },
  { path: 'src/services/layerBuilder/audioTrackCompositionPlaybackMixdowns.ts', maxCurrentHits: 1 },
  { path: 'src/services/photogrammetry/cameraSolveTimelineOutputs.ts', maxCurrentHits: 15 },
  { path: 'src/services/photogrammetry/placeSplatOnTimeline.ts', maxCurrentHits: 6 },
  { path: 'src/services/planarTracking/createTrackingScene.ts', maxCurrentHits: 5 },
  { path: 'src/services/planarTracking/editableFootstepPrototype.ts', maxCurrentHits: 2 },
  { path: 'src/services/planarTracking/editableTerrainSequence.ts', maxCurrentHits: 4 },
  { path: 'src/services/planarTracking/surfaceTrackEditing.ts', maxCurrentHits: 3 },
  { path: 'src/services/planarTracking/terrainLayerBindings.ts', maxCurrentHits: 1 },
  { path: 'src/services/planarTracking/trackingAssets.ts', maxCurrentHits: 7 },
  { path: 'src/services/planarTracking/trackingBinding.ts', maxCurrentHits: 1 },
  { path: 'src/stores/slotGridPanelStore.ts', maxCurrentHits: 1 },
  { path: 'src/stores/streamStore.ts', maxCurrentHits: 1 },
  { path: 'src/stores/trackingStore.ts', maxCurrentHits: 1 },
  { path: 'src/stores/timeline/editOperations/activeCompositionFrameRate.ts', maxCurrentHits: 1 },

  // Packet 345: 5 -> 2+1+1 (presenter + recovery wiring; one site retired
  // via restore-loop dedup, maxHits 656 -> 655).
  { path: 'src/engine/WebGPUEngine.ts', maxCurrentHits: 2 },
  // Device recovery now republishes each rebuilt target canvas (+1) and
  // publishes ready/failure state in all three lifecycle callbacks (+6).
  { path: 'src/engine/engineCore/outputPresenter.ts', maxCurrentHits: 2 },
  { path: 'src/engine/engineCore/contextRecoveryWiring.ts', maxCurrentHits: 7 },
  { path: 'src/engine/engineCore/outputWindowController.ts', maxCurrentHits: 7 },

  // Source resolution was extracted without adding reads: 13 -> 11 + 2.
  { path: 'src/services/timelinePlacementCommands.ts', maxCurrentHits: 11 },
  { path: 'src/services/timelinePlacementSource.ts', maxCurrentHits: 2 },
  // Re-read the nested source hash after async restoration so superseded
  // refreshes cannot commit stale media into a newer composition edit (+1).
  { path: 'src/stores/timeline/clip/compositionClipActions.ts', maxCurrentHits: 3 },

  // Project creation clears tracking before the first save; frame capture
  // samples the active composition and restores playback only after export.
  { path: 'src/components/common/toolbar/useToolbarProjectActions.ts', maxCurrentHits: 1 },
  { path: 'src/components/export/captureCompositionFrame.ts', maxCurrentHits: 6 },

  // Depth/face jobs validate source ranges and composition identity across
  // awaits. Completion and UI actions publish to the current tracking store.
  { path: 'src/components/panels/properties/DepthEstimationControls.tsx', maxCurrentHits: 6 },
  { path: 'src/components/panels/properties/FaceStabilizationControls.tsx', maxCurrentHits: 1 },
  { path: 'src/components/panels/properties/PreciseFaceTrackingControls.tsx', maxCurrentHits: 4 },
  { path: 'src/services/landmarkTracking/bakeFaceStabilization.ts', maxCurrentHits: 4 },
  { path: 'src/services/landmarkTracking/preciseFaceTracking.ts', maxCurrentHits: 1 },
  { path: 'src/services/landmarkTracking/usePreciseFaceTrack.ts', maxCurrentHits: 1 },

  // Cable edits/bakes read current clip, media, and history state at command or
  // preview time, including post-bake invalidation and freshly inserted objects.
  { path: 'src/components/panels/properties/FaceCableLightControls.tsx', maxCurrentHits: 7 },
  { path: 'src/services/faceCables/bakeFaceCables.ts', maxCurrentHits: 9 },
  { path: 'src/services/faceCables/previewFaceCables.ts', maxCurrentHits: 2 },
  { path: 'src/services/faceCables/useCablePreview.ts', maxCurrentHits: 1 },
  // Each of these also has one render snapshot beside its action-time reads.
  // Those snapshots remain reduction debt; playback subscriptions are currently
  // throttled by the controls and are not exempted from the exact file caps.
  { path: 'src/components/panels/properties/FaceCableEnvironmentControls.tsx', maxCurrentHits: 3 },
  { path: 'src/components/panels/properties/useFaceCableAnimation.tsx', maxCurrentHits: 5 },

  // Memory freeze samples composition/time on activation; live windows read
  // the active frame rate at sampling time. The broad scanner also counts the
  // controls' two heap-source snapshots (not Zustand); keep them visible here.
  { path: 'src/effects/generate/memoryLeak/MemoryLeakControls.tsx', maxCurrentHits: 4 },
  { path: 'src/effects/generate/memoryLeak/memorySource.ts', maxCurrentHits: 1 },
] as const;

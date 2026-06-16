import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function readSource(repoPath: string): string {
  return readFileSync(path.join(repoRoot, repoPath), 'utf8');
}

describe('render host service caller boundary', () => {
  const serviceCallerPaths = [
    'src/services/mediaRuntime/webCodecsPlayback.ts',
    'src/services/mediaRuntime/runtimePlayback.ts',
    'src/services/layerBuilder/layerBuilderProxyFrames.ts',
    'src/services/timeline/lazyImageElements.ts',
    'src/services/videoBakeProxyCache.ts',
    'src/services/midi/midiParameterApplicators.ts',
    'src/services/aiTools/handlers/renderOnce.ts',
    'src/services/aiTools/handlers/stressTest/mainComposition.ts',
    'src/services/aiTools/handlers/stressTest/createFixture.ts',
    'src/services/aiTools/handlers/stats.ts',
    'src/services/aiTools/handlers/export.ts',
    'src/services/aiTools/devBridge/browser/debugActions/performance.ts',
    'src/services/aiTools/handlers/smokes/smokeRuntime.ts',
    'src/services/aiTools/handlers/smokes/smokeFixtures.ts',
    'src/services/aiTools/handlers/preview.ts',
    'src/services/aiTools/utils.ts',
    'src/services/previewFrameCapture.ts',
    'src/services/clipAnalyzer.ts',
    'src/services/renderScheduler.ts',
    'src/services/layerBuilder/LayerBuilderService.ts',
    'src/services/playbackHealthMonitor.ts',
    'src/services/layerBuilder/VideoSyncManager.ts',
    'src/services/layerBuilder/videoSyncHtmlReversePlayback.ts',
    'src/services/layerBuilder/videoSyncFullWebCodecsCoordinator.ts',
    'src/services/layerBuilder/videoSyncWarmupCoordinator.ts',
    'src/services/layerBuilder/videoSyncRecoveryCoordinator.ts',
    'src/services/layerBuilder/videoSyncNestedCompositionCoordinator.ts',
    'src/services/layerBuilder/videoSyncHtmlTransitionHold.ts',
    'src/services/layerBuilder/videoSyncHtmlSeekCoordinator.ts',
    'src/services/layerBuilder/videoSyncHtmlClipCoordinator.ts',
    'src/services/layerBuilder/videoSyncHandoffs.ts',
    'src/services/layerBuilder/videoSyncForceDecodeManager.ts',
    'src/services/timeline/lazyMediaElements.ts',
    'src/services/timeline/timelineClipSourceRuntimeCleanup.ts',
    'src/stores/mediaStore/slices/fileManage/deleteRuntimeCleanup.ts',
    'src/services/layerPlaybackManager.ts',
    'src/services/layerPlayback/clipMediaLoaders.ts',
    'src/services/slotDeckManager.ts',
    'src/stores/mediaStore/slices/projectSlice.ts',
    'src/hooks/useEngine.ts',
    'src/hooks/engine/useEngineTimelineStateSync.ts',
    'src/hooks/engine/useEngineResolutionSync.ts',
    'src/hooks/engine/useEngineMaskTextureSync.ts',
    'src/components/timeline/hooks/useLayerSync.ts',
    'src/components/panels/SAM2Panel.tsx',
    'src/components/preview/SAM2Overlay.tsx',
    'src/components/panels/scopes/useScopeAnalysis.ts',
    'src/hooks/useGlobalHistory.ts',
    'src/stores/timeline/ramPreviewSlice.ts',
    'src/services/aiTools/handlers/smokes/ramPreview.ts',
    'src/stores/timeline/keyframeSlice.ts',
    'src/stores/timeline/serializationUtils.ts',
    'src/stores/timeline/keyframes/keyframeBasicActions.ts',
    'src/stores/timeline/playbackSlice.ts',
    'src/stores/timeline/proxyCacheSlice.ts',
    'src/stores/timeline/nodeGraphSlice.ts',
    'src/stores/timeline/motionClipSlice.ts',
    'src/stores/timeline/meshClipSlice.ts',
    'src/stores/timeline/textClipSlice.ts',
    'src/stores/timeline/solidClipSlice.ts',
    'src/stores/timeline/mathSceneClipSlice.ts',
  ];

  it('routes selected runtime/provider render wake commands through RenderHostPort', () => {
    for (const repoPath of serviceCallerPaths) {
      const source = readSource(repoPath);

      expect(source, repoPath).toContain('renderHostPort');
      expect(source, repoPath).not.toMatch(/(?:from\s+['"][^'"]*WebGPUEngine|import\(['"][^'"]*WebGPUEngine)/);
      expect(source, repoPath).not.toMatch(/\bengine\.request(?:NewFrame)?Render\(/);
      expect(source, repoPath).not.toMatch(/\bengine\.clear(?:Video|Scrubbing|Composite|Caches)/);
      expect(source, repoPath).not.toMatch(/\bengine\.(?:render|renderCachedFrame|cacheCompositeFrame|cacheActiveCompOutput|setContinuousRender|setTimelineVisualDemand|setIsPlaying|setIsScrubbing)\(/);
      expect(source, repoPath).not.toMatch(/\bengine\.(?:setResolution|getOutputDimensions|updateMaskTexture|removeMaskTexture|getTextureManager)\(/);
      expect(source, repoPath).not.toMatch(/\bengine\.(?:readPixels|getCaptureCanvas)\(/);
      expect(source, repoPath).not.toMatch(/\bengine\.(?:getDevice|getLastRenderedTexture)\(/);
      expect(source, repoPath).not.toMatch(/\bengine\.(?:clearFrame|setGeneratingRamPreview|getScrubbingCachedRanges)\(/);
      expect(source, repoPath).not.toMatch(/\bengine\.(?:getScrubbingCacheStats|getCompositeCacheStats|getRenderLoop|getDebugInfrastructureState|getRenderDispatcherDebugSnapshot)\(/);
      expect(source, repoPath).not.toMatch(/\bengine\.(?:getStats|getLayerCollector)\(/);
      expect(source, repoPath).not.toMatch(/\bengine\.(?:getIsExporting|renderToPreviewCanvas|copyNestedCompTextureToPreview)\(/);
    }
  });

  it('keeps RAM-preview rendering injected through RenderHostPort instead of the engine singleton', () => {
    for (const repoPath of [
      'src/stores/timeline/ramPreviewSlice.ts',
      'src/services/aiTools/handlers/smokes/ramPreview.ts',
    ]) {
      const source = readSource(repoPath);

      expect(source, repoPath).toContain('renderHostPort.getRamPreviewRenderEngine()');
      expect(source, repoPath).not.toMatch(/new\s+RamPreviewEngine\(engine\)/);
      expect(source, repoPath).not.toMatch(/(?:from\s+['"][^'"]*WebGPUEngine|import\(['"][^'"]*WebGPUEngine)/);
    }
  });
});

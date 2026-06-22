// AI Tool Handlers - Main dispatcher

import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import {
  FACTORY_AUDIO_EDIT_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  useDockStore,
} from '../../../stores/dockStore';
import type { ToolResult } from '../types';
import type { CallerContext } from '../policy';
import { normalizeToolName } from '../policy';

// Import handlers by category
import {
  handleGetTimelineState,
  handleSetPlayhead,
  handleSetInOutPoints,
} from './timeline';

import {
  handleGetClipDetails,
  handleGetClipsInTimeRange,
  handleSplitClip,
  handleDeleteClip,
  handleDeleteClips,
  handleCutRangesFromClip,
  handleMoveClip,
  handleTrimClip,
  handleSplitClipEvenly,
  handleSplitClipAtTimes,
  handleReorderClips,
  handleSelectClips,
  handleClearSelection,
  handleAddClipSegment,
} from './clips';

import {
  handleCreateTrack,
  handleDeleteTrack,
  handleSetTrackVisibility,
  handleSetTrackMuted,
} from './tracks';

import {
  handleGetClipAnalysis,
  handleGetClipTranscript,
  handleFindSilentSections,
  handleFindLowQualitySections,
  handleStartClipAnalysis,
  handleStartClipTranscription,
} from './analysis';

import {
  handleCaptureFrame,
  handleGetCutPreviewQuad,
  handleGetFramesAtTimes,
} from './preview';
import { handleRunPixelParticleDisintegrateQa } from './pixelParticleDisintegrateQa';

import {
  handleGetMediaItems,
  handleCreateMediaFolder,
  handleRenameMediaItem,
  handleDeleteMediaItem,
  handleMoveMediaItems,
  handleCreateComposition,
  handleOpenComposition,
  handleSelectMediaItems,
  handleImportLocalFiles,
  handleListLocalFiles,
} from './media';

import {
  handleSearchYouTube,
  handleListVideoFormats,
  handleDownloadAndImportVideo,
  handleGetYouTubeVideos,
} from './youtube';

import { handleSetTransform } from './transform';

import {
  handleListEffects,
  handleAddEffect,
  handleRemoveEffect,
  handleUpdateEffect,
} from './effects';

import {
  handleGetKeyframes,
  handleAddKeyframe,
  handleRemoveKeyframe,
} from './keyframes';

import {
  handlePlay,
  handlePause,
  handleSimulateFrameKeypresses,
  handleMonitorManualPause,
  handleSimulateScrub,
  handleSimulatePlayback,
  handleSimulatePlaybackPulses,
  handleSimulatePlaybackPath,
  handleSetClipSpeed,
  handleUndo,
  handleRedo,
  handleAddMarker,
  handleGetMarkers,
  handleRemoveMarker,
} from './playback';

import {
  handleAddTransition,
  handleRemoveTransition,
} from './transitions';

import {
  handleGetMasks,
  handleAddRectangleMask,
  handleAddEllipseMask,
  handleAddMask,
  handleRemoveMask,
  handleUpdateMask,
  handleAddVertex,
  handleRemoveVertex,
  handleUpdateVertex,
  handleAddMaskPathKeyframe,
} from './masks';

import {
  handleGetStats,
  handleGetAudioDiagnostics,
  handleGetLogs,
  handleGetRuntimeDiagnostics,
  handleGetPlaybackTrace,
  handleGetStatsHistory,
  handleClearRuntimeDiagnostics,
  handlePurgePlaybackPath,
} from './stats';
import { handleSamplePlaybackFramePacing } from './framePacing';
import { handleSetRenderHostMode } from './renderHost';
import { handleRunWorkerFirstRenderCapabilityProbe } from '../workerFirstCapabilityProbeBridge';
import { handleRunWorkerFirstBakeGoldenFixture } from '../workerFirstBakeGoldenFixture';
import { handleRunWorkerFirstBakeShadowParity } from '../workerFirstBakeShadowParity';
import { handleRunWorkerFirstEffectsMasksTransitionsGoldenFixture } from '../workerFirstEffectsMasksTransitionsGoldenFixture';
import { handleRunWorkerFirstEffectsMasksTransitionsShadowParity } from '../workerFirstEffectsMasksTransitionsShadowParity';
import { handleRunWorkerFirstExportGoldenFixture } from '../workerFirstExportGoldenFixture';
import { handleRunWorkerFirstExportShadowParity } from '../workerFirstExportShadowParity';
import { handleCaptureWorkerFirstGoldenFixtureFingerprint } from '../workerFirstGoldenFixtureBridge';
import { handleRunWorkerFirstHtmlProviderGoldenFixture } from '../workerFirstHtmlProviderGoldenFixture';
import { handleRunWorkerFirstHtmlProviderShadowParity } from '../workerFirstHtmlProviderShadowParity';
import { handleRunWorkerFirstJpegProxyGoldenFixture } from '../workerFirstJpegProxyGoldenFixture';
import { handleRunWorkerFirstJpegProxyShadowParity } from '../workerFirstJpegProxyShadowParity';
import { handleRunWorkerFirstMultiTargetOutputSliceGoldenFixture } from '../workerFirstMultiTargetOutputSliceGoldenFixture';
import { handleRunWorkerFirstMultiTargetOutputSliceShadowParity } from '../workerFirstMultiTargetOutputSliceShadowParity';
import { handleRunWorkerFirstMultiVideoGoldenFixture } from '../workerFirstMultiVideoGoldenFixture';
import { handleRunWorkerFirstMultiVideoShadowParity } from '../workerFirstMultiVideoShadowParity';
import { handleRunWorkerFirstNestedCompsGoldenFixture } from '../workerFirstNestedCompsGoldenFixture';
import { handleRunWorkerFirstNestedCompsShadowParity } from '../workerFirstNestedCompsShadowParity';
import { handleRunWorkerFirstRamCacheGoldenFixture } from '../workerFirstRamCacheGoldenFixture';
import { handleRunWorkerFirstRamCacheShadowParity } from '../workerFirstRamCacheShadowParity';
import {
  handleRunWorkerFirstRealVideoRuntimeSmoke,
  handleRunWorkerFirstRuntimeExportPlaybackSmoke,
} from '../workerFirstRuntimeExportPlaybackSmoke';
import { handleRunWorkerFirstPlatformEvidencePackage } from '../workerFirstPlatformEvidencePackage';
import { handleVerifyWorkerFirstPlatformEvidenceMatrix } from '../workerFirstPlatformEvidenceMatrix';
import { handleRunWorkerFirstSolidTextImageGoldenFixture } from '../workerFirstSolidTextImageGoldenFixture';
import { handleRunWorkerFirstSolidTextImageShadowParity } from '../workerFirstSolidTextImageShadowParity';
import { handleRunWorkerFirstUniversal3dGoldenFixture } from '../workerFirstUniversal3dGoldenFixture';
import { handleRunWorkerFirstUniversal3dShadowParity } from '../workerFirstUniversal3dShadowParity';
import { handleRunWorkerFirstW5EvidenceSuite } from '../workerFirstW5EvidenceSuite';
import { handleRunWorkerFirstWebCodecsProviderGoldenFixture } from '../workerFirstWebCodecsProviderGoldenFixture';
import { handleRunWorkerFirstWebCodecsProviderShadowParity } from '../workerFirstWebCodecsProviderShadowParity';
import { handleCaptureWorkerFirstVisiblePresentationProof } from '../workerFirstVisibleCaptureBridge';
import { handleRunWorkerFirstVisiblePresentationStressProof } from '../workerFirstVisibleStressBridge';
import { handleDebugExport } from './export';
import { handleCreateStressTestProjectFixture } from './stressTest';
import {
  handleRunTimelineCanvasBladeToolSmoke,
  handleRunTimelineCanvasExportPreviewParitySmoke,
  handleRunTimelineCanvasLargeProjectSmoke,
  handleRunTimelineCanvasMarqueeSmoke,
  handleRunTimelineCanvasPlayheadSmoothnessSmoke,
  handleRunTimelineCanvasRamPreviewSmoke,
  handleRunTimelineCanvasSpectralPlaybackSmoke,
  handleRunTimelineCanvasThumbnailReloadSmoke,
} from './timelineCanvasSmoke';
import {
  handleGetNodeWorkspaceDebugState,
  handleSendAINodePrompt,
} from './nodeWorkspace';

// Handler registry - maps tool names to handler functions
const timelineHandlers: Record<string, (args: Record<string, unknown>, store: ReturnType<typeof useTimelineStore.getState>, callerContext?: CallerContext) => Promise<ToolResult>> = {
  getTimelineState: handleGetTimelineState,
  setPlayhead: handleSetPlayhead,
  setInOutPoints: handleSetInOutPoints,
  getClipDetails: handleGetClipDetails,
  getClipsInTimeRange: handleGetClipsInTimeRange,
  splitClip: handleSplitClip,
  deleteClip: handleDeleteClip,
  deleteClips: handleDeleteClips,
  cutRangesFromClip: handleCutRangesFromClip,
  moveClip: handleMoveClip,
  trimClip: handleTrimClip,
  splitClipEvenly: handleSplitClipEvenly,
  splitClipAtTimes: handleSplitClipAtTimes,
  reorderClips: handleReorderClips,
  selectClips: handleSelectClips,
  clearSelection: handleClearSelection,
  createTrack: handleCreateTrack,
  deleteTrack: handleDeleteTrack,
  setTrackVisibility: handleSetTrackVisibility,
  setTrackMuted: handleSetTrackMuted,
  getClipAnalysis: handleGetClipAnalysis,
  getClipTranscript: handleGetClipTranscript,
  findSilentSections: handleFindSilentSections,
  findLowQualitySections: handleFindLowQualitySections,
  startClipAnalysis: handleStartClipAnalysis,
  startClipTranscription: handleStartClipTranscription,
  captureFrame: handleCaptureFrame,
  getCutPreviewQuad: handleGetCutPreviewQuad,
  getFramesAtTimes: handleGetFramesAtTimes,
  runPixelParticleDisintegrateQa: async (args: Record<string, unknown>) =>
    handleRunPixelParticleDisintegrateQa(args),
  // Transform
  setTransform: handleSetTransform,
  // Effects
  addEffect: handleAddEffect,
  removeEffect: handleRemoveEffect,
  updateEffect: handleUpdateEffect,
  // Keyframes
  getKeyframes: handleGetKeyframes,
  addKeyframe: handleAddKeyframe,
  // Playback & Control
  play: handlePlay,
  pause: handlePause,
  monitorManualPause: handleMonitorManualPause,
  simulateFrameKeypresses: handleSimulateFrameKeypresses,
  simulateScrub: handleSimulateScrub,
  simulatePlayback: handleSimulatePlayback,
  simulatePlaybackPulses: handleSimulatePlaybackPulses,
  simulatePlaybackPath: handleSimulatePlaybackPath,
  setClipSpeed: handleSetClipSpeed,
  // Markers
  addMarker: handleAddMarker,
  getMarkers: handleGetMarkers,
  removeMarker: handleRemoveMarker,
  // Transitions
  addTransition: handleAddTransition,
  removeTransition: handleRemoveTransition,
  // Masks
  getMasks: handleGetMasks,
  addRectangleMask: handleAddRectangleMask,
  addEllipseMask: handleAddEllipseMask,
  addMask: handleAddMask,
  removeMask: handleRemoveMask,
  updateMask: handleUpdateMask,
  addVertex: handleAddVertex,
  removeVertex: handleRemoveVertex,
  updateVertex: handleUpdateVertex,
  addMaskPathKeyframe: handleAddMaskPathKeyframe,
};

const mediaHandlers: Record<string, (args: Record<string, unknown>, store: ReturnType<typeof useMediaStore.getState>, callerContext?: CallerContext) => Promise<ToolResult>> = {
  getMediaItems: handleGetMediaItems,
  createMediaFolder: handleCreateMediaFolder,
  renameMediaItem: handleRenameMediaItem,
  deleteMediaItem: handleDeleteMediaItem,
  moveMediaItems: handleMoveMediaItems,
  createComposition: handleCreateComposition,
  openComposition: handleOpenComposition,
  selectMediaItems: handleSelectMediaItems,
  importLocalFiles: handleImportLocalFiles,
};

// Self-contained handlers (no store dependency, or fetch own stores)
const selfContainedHandlers: Record<string, (args: Record<string, unknown>, callerContext?: CallerContext) => Promise<ToolResult>> = {
  listLocalFiles: handleListLocalFiles,
  addClipSegment: handleAddClipSegment,
  listEffects: handleListEffects,
  removeKeyframe: handleRemoveKeyframe,
  undo: handleUndo,
  redo: handleRedo,
  // App control
  reloadApp: async (args: Record<string, unknown>) => {
    const mode = (args.mode as string) || 'hard';
    const delayMs = typeof args.delayMs === 'number' ? args.delayMs : 100;
    setTimeout(() => {
      if (mode === 'hard') {
        window.location.reload();
      } else {
        window.location.replace(window.location.href);
      }
    }, delayMs);
    return { success: true, data: { mode, delayMs, reloading: true } };
  },
  // Stats
  getStats: handleGetStats,
  getAudioDiagnostics: handleGetAudioDiagnostics,
  getStatsHistory: handleGetStatsHistory,
  getLogs: handleGetLogs,
  getRuntimeDiagnostics: handleGetRuntimeDiagnostics,
  clearRuntimeDiagnostics: handleClearRuntimeDiagnostics,
  getPlaybackTrace: handleGetPlaybackTrace,
  samplePlaybackFramePacing: handleSamplePlaybackFramePacing,
  purgePlaybackPath: handlePurgePlaybackPath,
  runWorkerFirstRenderCapabilityProbe: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstRenderCapabilityProbe(args),
  runWorkerFirstSolidTextImageGoldenFixture: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstSolidTextImageGoldenFixture(args),
  runWorkerFirstMultiVideoGoldenFixture: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstMultiVideoGoldenFixture(args),
  runWorkerFirstMultiVideoShadowParity: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstMultiVideoShadowParity(args),
  runWorkerFirstWebCodecsProviderGoldenFixture: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstWebCodecsProviderGoldenFixture(args),
  runWorkerFirstWebCodecsProviderShadowParity: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstWebCodecsProviderShadowParity(args),
  runWorkerFirstHtmlProviderGoldenFixture: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstHtmlProviderGoldenFixture(args),
  runWorkerFirstHtmlProviderShadowParity: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstHtmlProviderShadowParity(args),
  runWorkerFirstJpegProxyGoldenFixture: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstJpegProxyGoldenFixture(args),
  runWorkerFirstJpegProxyShadowParity: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstJpegProxyShadowParity(args),
  runWorkerFirstMultiTargetOutputSliceGoldenFixture: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstMultiTargetOutputSliceGoldenFixture(args),
  runWorkerFirstMultiTargetOutputSliceShadowParity: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstMultiTargetOutputSliceShadowParity(args),
  runWorkerFirstRamCacheGoldenFixture: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstRamCacheGoldenFixture(args),
  runWorkerFirstRamCacheShadowParity: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstRamCacheShadowParity(args),
  runWorkerFirstBakeGoldenFixture: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstBakeGoldenFixture(args),
  runWorkerFirstBakeShadowParity: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstBakeShadowParity(args),
  runWorkerFirstExportGoldenFixture: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstExportGoldenFixture(args),
  runWorkerFirstExportShadowParity: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstExportShadowParity(args),
  runWorkerFirstUniversal3dGoldenFixture: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstUniversal3dGoldenFixture(args),
  runWorkerFirstUniversal3dShadowParity: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstUniversal3dShadowParity(args),
  runWorkerFirstW5EvidenceSuite: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstW5EvidenceSuite(args),
  runWorkerFirstPlatformEvidencePackage: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstPlatformEvidencePackage(args),
  verifyWorkerFirstPlatformEvidenceMatrix: async (args: Record<string, unknown>) =>
    handleVerifyWorkerFirstPlatformEvidenceMatrix(args),
  runWorkerFirstRuntimeExportPlaybackSmoke: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstRuntimeExportPlaybackSmoke(args),
  runWorkerFirstRealVideoRuntimeSmoke: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstRealVideoRuntimeSmoke(args),
  runWorkerFirstEffectsMasksTransitionsGoldenFixture: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstEffectsMasksTransitionsGoldenFixture(args),
  runWorkerFirstEffectsMasksTransitionsShadowParity: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstEffectsMasksTransitionsShadowParity(args),
  runWorkerFirstNestedCompsGoldenFixture: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstNestedCompsGoldenFixture(args),
  runWorkerFirstNestedCompsShadowParity: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstNestedCompsShadowParity(args),
  runWorkerFirstSolidTextImageShadowParity: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstSolidTextImageShadowParity(args),
  captureWorkerFirstGoldenFixtureFingerprint: async (args: Record<string, unknown>) =>
    handleCaptureWorkerFirstGoldenFixtureFingerprint(args),
  captureWorkerFirstVisiblePresentationProof: async (args: Record<string, unknown>) =>
    handleCaptureWorkerFirstVisiblePresentationProof(args),
  runWorkerFirstVisiblePresentationStressProof: async (args: Record<string, unknown>) =>
    handleRunWorkerFirstVisiblePresentationStressProof(args),
  debugExport: handleDebugExport,
  createStressTestProjectFixture: handleCreateStressTestProjectFixture,
  runTimelineCanvasBladeToolSmoke: handleRunTimelineCanvasBladeToolSmoke,
  runTimelineCanvasExportPreviewParitySmoke: handleRunTimelineCanvasExportPreviewParitySmoke,
  runTimelineCanvasLargeProjectSmoke: handleRunTimelineCanvasLargeProjectSmoke,
  runTimelineCanvasMarqueeSmoke: handleRunTimelineCanvasMarqueeSmoke,
  runTimelineCanvasPlayheadSmoothnessSmoke: handleRunTimelineCanvasPlayheadSmoothnessSmoke,
  runTimelineCanvasThumbnailReloadSmoke: handleRunTimelineCanvasThumbnailReloadSmoke,
  runTimelineCanvasRamPreviewSmoke: handleRunTimelineCanvasRamPreviewSmoke,
  runTimelineCanvasSpectralPlaybackSmoke: handleRunTimelineCanvasSpectralPlaybackSmoke,
  setRenderHostMode: handleSetRenderHostMode,
  getNodeWorkspaceDebugState: handleGetNodeWorkspaceDebugState,
  sendAINodePrompt: handleSendAINodePrompt,
  getDockLayoutDebugState: handleGetDockLayoutDebugState,
  switchDockLayout: handleSwitchDockLayout,
};

// YouTube handlers - self-contained, fetch their own stores
const youtubeHandlers: Record<string, (args: Record<string, unknown>, callerContext?: CallerContext) => Promise<ToolResult>> = {
  searchYouTube: handleSearchYouTube,
  searchVideos: handleSearchYouTube,
  listVideoFormats: handleListVideoFormats,
  downloadAndImportVideo: handleDownloadAndImportVideo,
  getYouTubeVideos: handleGetYouTubeVideos,
};

function collectDockLayoutDebugState(): Record<string, unknown> {
  const dockState = useDockStore.getState();
  const collectElementDebug = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
      id: element.dataset.dockLayoutAnimId ?? element.dataset.dockLayoutChildAnimId ?? element.dataset.clipId ?? null,
      className: element.className,
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      visibility: style.visibility,
      display: style.display,
      opacity: style.opacity,
      inlineVisibility: element.style.visibility,
    };
  };
  const previewElements = typeof document === 'undefined'
    ? []
    : Array.from(document.querySelectorAll<HTMLElement>(
      '[data-dock-layout-anim-id="panel:preview"], [data-dock-layout-anim-id^="panel:preview-"], [data-dock-layout-anim-id="panel:multi-preview"], [data-dock-layout-anim-id^="panel:multi-preview-"]',
    )).map((element) => {
      const canvases = Array.from(element.querySelectorAll<HTMLCanvasElement>('canvas')).map((canvas) => ({
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
        display: window.getComputedStyle(canvas).display,
        visibility: window.getComputedStyle(canvas).visibility,
      }));

      return {
        ...collectElementDebug(element),
        visibility: window.getComputedStyle(element).visibility,
        display: window.getComputedStyle(element).display,
        canvasCount: canvases.length,
        canvases,
      };
    });
  const timelineElements = typeof document === 'undefined'
    ? []
    : Array.from(document.querySelectorAll<HTMLElement>(
      '[data-dock-layout-anim-id="panel:timeline"], [data-dock-layout-anim-id="group:timeline-group"], .timeline-container, .track-lane.audio, .timeline-clip-canvas, .clip-interaction-shell, .timeline-clip-preview',
    )).map((element) => collectElementDebug(element));
  const waveformCanvases = typeof document === 'undefined'
    ? []
    : Array.from(document.querySelectorAll<HTMLCanvasElement>('.timeline-clip-canvas')).map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      const style = window.getComputedStyle(canvas);
      const parent = canvas.parentElement;
      const parentRect = parent?.getBoundingClientRect();
      return {
        className: canvas.className,
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
        rect: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        parentRect: parentRect
          ? {
              left: Math.round(parentRect.left),
              top: Math.round(parentRect.top),
              width: Math.round(parentRect.width),
              height: Math.round(parentRect.height),
            }
          : null,
        visibility: style.visibility,
        display: style.display,
        opacity: style.opacity,
        inlineVisibility: canvas.style.visibility,
        cssWidth: canvas.style.width,
        cssLeft: canvas.style.left,
      };
    });

  return {
    activeSavedLayoutId: dockState.activeSavedLayoutId,
    savedLayouts: dockState.savedLayouts.map((layout) => ({
      id: layout.id,
      name: layout.name,
      favorite: layout.favorite === true,
      factory: layout.factory === true,
    })),
    previewElements,
    timelineElements,
    waveformCanvases,
  };
}

function resolveDockLayoutDebugId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'video' || normalized === 'video edit' || normalized === 'video-edit') {
    return FACTORY_VIDEO_EDIT_LAYOUT_ID;
  }
  if (normalized === 'audio' || normalized === 'audio edit' || normalized === 'audio-edit') {
    return FACTORY_AUDIO_EDIT_LAYOUT_ID;
  }

  const dockState = useDockStore.getState();
  return dockState.savedLayouts.find((layout) => (
    layout.id === value || layout.name.trim().toLowerCase() === normalized
  ))?.id ?? null;
}

async function handleGetDockLayoutDebugState(): Promise<ToolResult> {
  return { success: true, data: collectDockLayoutDebugState() };
}

async function handleSwitchDockLayout(args: Record<string, unknown>): Promise<ToolResult> {
  const layoutId = resolveDockLayoutDebugId(args.layoutId ?? args.id ?? args.name);
  if (!layoutId) {
    return {
      success: false,
      error: 'Unknown dock layout',
      data: collectDockLayoutDebugState(),
    };
  }

  useDockStore.getState().loadSavedLayout(layoutId);
  const waitMs = Math.max(0, Math.min(Number(args.waitMs) || 0, 5000));
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  return {
    success: true,
    data: collectDockLayoutDebugState(),
  };
}

/**
 * Execute a tool by name
 * Dispatches to the appropriate handler based on tool name
 */
export async function executeToolInternal(
  toolName: string,
  args: Record<string, unknown>,
  timelineStore: ReturnType<typeof useTimelineStore.getState>,
  mediaStore: ReturnType<typeof useMediaStore.getState>,
  callerContext: CallerContext = 'internal',
): Promise<ToolResult> {
  // Strip provider namespace prefixes (e.g. OpenAI's `functions.addClipSegment`)
  // so dispatch matches the registered handler name.
  toolName = normalizeToolName(toolName);

  // Check timeline handlers first
  if (toolName in timelineHandlers) {
    return timelineHandlers[toolName](args, timelineStore, callerContext);
  }

  // Check media handlers
  if (toolName in mediaHandlers) {
    return mediaHandlers[toolName](args, mediaStore, callerContext);
  }

  // Check self-contained handlers (no store dependency)
  if (toolName in selfContainedHandlers) {
    return selfContainedHandlers[toolName](args, callerContext);
  }

  // Check YouTube handlers
  if (toolName in youtubeHandlers) {
    return youtubeHandlers[toolName](args, callerContext);
  }

  // Unknown tool
  return { success: false, error: `Unknown tool: ${toolName}` };
}

// Re-export individual handlers for direct use if needed
export {
  // Timeline
  handleGetTimelineState,
  handleSetPlayhead,
  handleSetInOutPoints,
  // Clips
  handleGetClipDetails,
  handleGetClipsInTimeRange,
  handleSplitClip,
  handleDeleteClip,
  handleDeleteClips,
  handleCutRangesFromClip,
  handleMoveClip,
  handleTrimClip,
  handleSplitClipEvenly,
  handleSplitClipAtTimes,
  handleReorderClips,
  handleSelectClips,
  handleClearSelection,
  handleAddClipSegment,
  // Tracks
  handleCreateTrack,
  handleDeleteTrack,
  handleSetTrackVisibility,
  handleSetTrackMuted,
  // Analysis
  handleGetClipAnalysis,
  handleGetClipTranscript,
  handleFindSilentSections,
  handleFindLowQualitySections,
  handleStartClipAnalysis,
  handleStartClipTranscription,
  // Preview
  handleCaptureFrame,
  handleGetCutPreviewQuad,
  handleGetFramesAtTimes,
  // Media
  handleGetMediaItems,
  handleCreateMediaFolder,
  handleRenameMediaItem,
  handleDeleteMediaItem,
  handleMoveMediaItems,
  handleCreateComposition,
  handleOpenComposition,
  handleSelectMediaItems,
  handleImportLocalFiles,
  handleListLocalFiles,
  // YouTube
  handleSearchYouTube,
  handleListVideoFormats,
  handleDownloadAndImportVideo,
  handleGetYouTubeVideos,
  // Transform
  handleSetTransform,
  // Effects
  handleListEffects,
  handleAddEffect,
  handleRemoveEffect,
  handleUpdateEffect,
  // Keyframes
  handleGetKeyframes,
  handleAddKeyframe,
  handleRemoveKeyframe,
  // Playback & Control
  handlePlay,
  handlePause,
  handleSimulateFrameKeypresses,
  handleSimulateScrub,
  handleSimulatePlayback,
  handleSimulatePlaybackPulses,
  handleSimulatePlaybackPath,
  handleSetClipSpeed,
  handleUndo,
  handleRedo,
  // Markers
  handleAddMarker,
  handleGetMarkers,
  handleRemoveMarker,
  // Transitions
  handleAddTransition,
  handleRemoveTransition,
  // Masks
  handleGetMasks,
  handleAddRectangleMask,
  handleAddEllipseMask,
  handleAddMask,
  handleRemoveMask,
  handleUpdateMask,
  handleAddVertex,
  handleRemoveVertex,
  handleUpdateVertex,
  // Stats
  handleGetStats,
  handleGetLogs,
  handleGetRuntimeDiagnostics,
  handleGetPlaybackTrace,
  handleGetStatsHistory,
  handleSamplePlaybackFramePacing,
  handleRunWorkerFirstPlatformEvidencePackage,
  handleRunWorkerFirstEffectsMasksTransitionsShadowParity,
  handleCaptureWorkerFirstVisiblePresentationProof,
  handleRunWorkerFirstVisiblePresentationStressProof,
  handleClearRuntimeDiagnostics,
  handleDebugExport,
  handleCreateStressTestProjectFixture,
  handleRunTimelineCanvasLargeProjectSmoke,
  handleRunTimelineCanvasMarqueeSmoke,
  handleRunTimelineCanvasPlayheadSmoothnessSmoke,
  handleRunTimelineCanvasRamPreviewSmoke,
  handleRunTimelineCanvasSpectralPlaybackSmoke,
  handleRunTimelineCanvasThumbnailReloadSmoke,
  handleGetNodeWorkspaceDebugState,
  handleSendAINodePrompt,
};

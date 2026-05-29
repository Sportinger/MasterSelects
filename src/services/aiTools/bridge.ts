/**
 * AI Tools Bridge - connects browser to Vite dev server via HMR
 * so external agents (Claude CLI) can execute aiTools via HTTP POST.
 *
 * Flow: POST /api/ai-tools → Vite server → HMR → browser → aiTools.execute() → HMR → HTTP response
 *
 * Uses direct import of executeAITool (not window.aiTools) to enforce 'devBridge' caller context.
 */
import { executeAITool, AI_TOOLS, getQuickTimelineSummary } from './index';
import type { AIToolExecutionOptions } from './types';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { useDockStore } from '../../stores/dockStore';
import { useGuidedActionStore } from '../../stores/guidedActionStore';
import { useRenderTargetStore } from '../../stores/renderTargetStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { layerPlaybackManager } from '../layerPlaybackManager';
import { layerBuilder } from '../layerBuilder';
import { projectFileService } from '../projectFileService';
import { loadProjectToStores } from '../project/projectLoad';
import { compileGuidedToolCall, inspectGuidedToolCall } from '../guidedActions';
import { getRuntimeDiagnostics } from '../runtimeDiagnostics';
import { runtimeAudioMeterBus } from '../audio/runtimeAudioMeterBus';
import { DEFAULT_STEM_MODEL_ID, getStemModelManager } from '../audio/stemSeparation';
import { proxyFrameCache } from '../proxyFrameCache';

const tabId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `tab-${Math.random().toString(36).slice(2, 10)}`;
const BRIDGE_GUIDED_OPTIONS_ARG = '__guidedOptions';

function getTabPriorityDelayMs(isTargetedRequest = false): number {
  if (typeof document === 'undefined') return 0;

  const isVisible = document.visibilityState === 'visible';
  const hasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;

  if (!isVisible) return isTargetedRequest ? 500 : -1;
  if (hasFocus) return 0;
  return 150;
}

function resolveBridgeToolExecution(
  args: unknown,
  options: unknown,
): { args: Record<string, unknown>; options: AIToolExecutionOptions } {
  const normalizedArgs = isRecord(args) ? args : {};
  const inlineOptions = normalizedArgs[BRIDGE_GUIDED_OPTIONS_ARG];
  const toolArgs = { ...normalizedArgs };
  delete toolArgs[BRIDGE_GUIDED_OPTIONS_ARG];

  return {
    args: toolArgs,
    options: sanitizeBridgeToolOptions(mergeBridgeOptions(inlineOptions, options)),
  };
}

function mergeBridgeOptions(inlineOptions: unknown, hmrOptions: unknown): unknown {
  if (isRecord(inlineOptions) || isRecord(hmrOptions)) {
    return {
      ...(isRecord(inlineOptions) ? inlineOptions : {}),
      ...(isRecord(hmrOptions) ? hmrOptions : {}),
    };
  }
  return hmrOptions ?? inlineOptions;
}

function sanitizeBridgeToolOptions(options: unknown): AIToolExecutionOptions {
  if (!isRecord(options)) {
    return {};
  }

  const sanitized: AIToolExecutionOptions = {};

  if (typeof options.guidedReplay === 'boolean') {
    sanitized.guidedReplay = options.guidedReplay;
  }

  if (typeof options.guidedAnimationBudgetMs === 'number' && Number.isFinite(options.guidedAnimationBudgetMs)) {
    sanitized.guidedAnimationBudgetMs = clampGuidedReplayBudgetMs(options.guidedAnimationBudgetMs);
  }

  if (isGuidedVisualizationMode(options.guidedVisualizationMode)) {
    sanitized.guidedVisualizationMode = options.guidedVisualizationMode;
  }

  if (isGuidedCompressionMode(options.guidedCompressionMode)) {
    sanitized.guidedCompressionMode = options.guidedCompressionMode;
  }

  if (isGuidedLegacyFeedback(options.guidedLegacyFeedback)) {
    sanitized.guidedLegacyFeedback = options.guidedLegacyFeedback;
  }

  return sanitized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGuidedVisualizationMode(value: unknown): value is NonNullable<AIToolExecutionOptions['guidedVisualizationMode']> {
  return value === 'off' || value === 'concise' || value === 'full';
}

function isGuidedCompressionMode(value: unknown): value is NonNullable<AIToolExecutionOptions['guidedCompressionMode']> {
  return value === 'none' || value === 'family' || value === 'aggressive';
}

function isGuidedLegacyFeedback(value: unknown): value is NonNullable<AIToolExecutionOptions['guidedLegacyFeedback']> {
  return value === 'native' || value === 'bridge' || value === 'off';
}

function clampGuidedReplayBudgetMs(value: number): number {
  return Math.max(0, Math.round(value));
}

function collectDebugState(scope: string = 'all') {
  const timelineState = useTimelineStore.getState();
  const mediaState = useMediaStore.getState();
  const dockState = useDockStore.getState();
  const guidedState = useGuidedActionStore.getState();
  const renderTargetState = useRenderTargetStore.getState();
  const activeLayers = Object.fromEntries(
    layerPlaybackManager.getActiveLayerIndices().map((layerIndex) => [
      layerIndex,
      layerPlaybackManager.getLayerPlaybackInfo(layerIndex),
    ]),
  );
  const activeComposition = mediaState.compositions.find((composition) => composition.id === mediaState.activeCompositionId);
  const activeCompositionTimeline = activeComposition?.timelineData;
  const persistedKeyframeCounts = (activeCompositionTimeline?.clips || [])
    .map((clip) => ({
      clipId: clip.id,
      count: Array.isArray(clip.keyframes) ? clip.keyframes.length : 0,
      properties: Array.from(new Set((clip.keyframes || []).map((keyframe) => keyframe.property))).sort(),
    }))
    .filter((entry) => entry.count > 0);

  const renderTargets = Array.from(renderTargetState.targets.values()).map((target) => ({
    id: target.id,
    name: target.name,
    source: target.source,
    enabled: target.enabled,
    destinationType: target.destinationType,
    hasCanvas: !!target.canvas,
    hasWindow: !!target.window,
    showTransparencyGrid: target.showTransparencyGrid,
  }));

  const keyframeCounts = Array.from(timelineState.clipKeyframes.entries()).map(([clipId, keyframes]) => ({
    clipId,
    count: keyframes.length,
    properties: Array.from(new Set(keyframes.map((keyframe) => keyframe.property))).sort(),
  }));

  let builtLayers: Array<{
    id: string;
    name: string;
    sourceType: string | null;
    sourceClipId?: string;
    is3D: boolean;
    hasNestedComposition: boolean;
  }> = [];

  if (scope === 'all' || scope === 'preview') {
    try {
      builtLayers = layerBuilder.buildLayersFromStore()
        .filter((layer): layer is NonNullable<typeof layer> => layer != null)
        .map((layer) => ({
          id: layer.id,
          name: layer.name,
          sourceType: layer.source?.type ?? null,
          sourceClipId: layer.sourceClipId,
          is3D: layer.is3D === true,
          hasNestedComposition: !!layer.source?.nestedComposition,
        }));
    } catch (error) {
      builtLayers = [{
        id: '__error__',
        name: error instanceof Error ? error.message : String(error),
        sourceType: 'error',
        is3D: false,
        hasNestedComposition: false,
      }];
    }
  }

  return {
    scope,
    capturedAt: new Date().toISOString(),
    tabId,
    timeline: {
      playheadPosition: timelineState.playheadPosition,
      isPlaying: timelineState.isPlaying,
      slotGridProgress: timelineState.slotGridProgress,
      selectedClipIds: Array.from(timelineState.selectedClipIds),
      primarySelectedClipId: timelineState.primarySelectedClipId,
      clipCount: timelineState.clips.length,
      keyframeClipCount: timelineState.clipKeyframes.size,
      keyframeCounts,
    },
    media: {
      activeCompositionId: mediaState.activeCompositionId,
      previewCompositionId: mediaState.previewCompositionId,
      selectedSlotCompositionId: mediaState.selectedSlotCompositionId,
      activeLayerSlots: mediaState.activeLayerSlots,
      slotAssignments: mediaState.slotAssignments,
      slotClipSettings: mediaState.slotClipSettings,
      openCompositionIds: mediaState.openCompositionIds,
      activeCompositionPersistedKeyframeClipCount: persistedKeyframeCounts.length,
      activeCompositionPersistedKeyframeCounts: persistedKeyframeCounts,
    },
    project: {
      isOpen: projectFileService.isProjectOpen(),
      hasUnsavedChanges: projectFileService.hasUnsavedChanges(),
    },
    guided: {
      activeSession: guidedState.activeSession
        ? {
            id: guidedState.activeSession.id,
            status: guidedState.activeSession.status,
            label: guidedState.activeSession.label,
            playbackMode: guidedState.activeSession.context.playbackMode,
            visualizationMode: guidedState.activeSession.context.visualizationMode,
            inputLockMode: guidedState.activeSession.context.inputLock.mode,
            plannedDurationMs: guidedState.activeSession.plan.diagnostics.plannedDurationMs,
            actionCount: guidedState.activeSession.plan.diagnostics.actionCount,
          }
        : null,
      currentStep: guidedState.currentStep
        ? {
            index: guidedState.currentStep.index,
            type: guidedState.currentStep.action.type,
            family: guidedState.currentStep.family,
            label: guidedState.currentStep.action.label,
            startsAtMs: guidedState.currentStep.startsAtMs,
            plannedDurationMs: guidedState.currentStep.plannedDurationMs,
          }
        : null,
      diagnosticCount: guidedState.diagnostics.length,
      recentDiagnostics: guidedState.diagnostics.slice(-5),
      eventCount: guidedState.eventLog.length,
    },
    layerPlayback: activeLayers,
    builtLayers,
    renderTargets,
    dock: {
      activePanelTypes: dockState.layout.root
        ? dockState.layout.root.kind === 'tab-group'
          ? dockState.layout.root.panels.map((panel) => panel.type)
          : []
        : [],
    },
  };
}

function inspectGuidedBridgeTool(args: Record<string, unknown>) {
  const tool = typeof args.tool === 'string'
    ? args.tool
    : typeof args.name === 'string'
      ? args.name
      : '';
  const toolArgs = isRecord(args.args) ? args.args : {};

  if (!tool) {
    return { success: false, error: 'Missing guided tool name. Pass { tool, args }.' };
  }

  const toolCall = { tool, args: toolArgs };
  const compiled = compileGuidedToolCall(toolCall);
  return {
    success: true,
    data: {
      actions: inspectGuidedToolCall(toolCall),
      diagnostics: compiled.diagnostics,
      tool,
    },
  };
}

async function withDebugTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

async function collectStemDebugState(args: Record<string, unknown> = {}) {
  const timelineState = useTimelineStore.getState();
  const modelId = typeof args.modelId === 'string' && args.modelId.trim()
    ? args.modelId.trim()
    : DEFAULT_STEM_MODEL_ID;
  const now = Date.now();
  let modelCacheStatus: unknown = null;
  let modelCacheError: string | null = null;

  try {
    modelCacheStatus = await withDebugTimeout(
      getStemModelManager().getCacheStatus(modelId),
      2500,
      'Timed out while reading stem model cache status.',
    );
  } catch (error) {
    modelCacheError = error instanceof Error ? error.message : String(error);
  }

  const interestingClipIds = new Set<string>([
    ...Array.from(timelineState.selectedClipIds),
    ...Object.keys(timelineState.clipStemSeparationJobs),
  ]);
  const includeAllClips = args.includeAll === true || args.all === true;
  if (timelineState.primarySelectedClipId) {
    interestingClipIds.add(timelineState.primarySelectedClipId);
  }
  if (typeof args.clipId === 'string' && args.clipId.trim()) {
    interestingClipIds.add(args.clipId.trim());
  }
  for (const job of Object.values(timelineState.clipStemSeparationJobs)) {
    interestingClipIds.add(job.clipId);
    interestingClipIds.add(job.requestedClipId);
  }

  const clips = timelineState.clips
    .filter((clip) =>
      includeAllClips ||
      interestingClipIds.has(clip.id) ||
      (typeof clip.linkedClipId === 'string' && interestingClipIds.has(clip.linkedClipId))
    )
    .map((clip) => ({
      id: clip.id,
      name: clip.name,
      trackId: clip.trackId,
      sourceType: clip.source?.type ?? null,
      linkedClipId: clip.linkedClipId ?? null,
      hasFile: clip.file instanceof File,
      fileName: clip.file instanceof File ? clip.file.name : null,
      fileType: clip.file instanceof File ? clip.file.type : null,
      fileSize: clip.file instanceof File ? clip.file.size : null,
      duration: clip.duration,
      inPoint: clip.inPoint ?? null,
      outPoint: clip.outPoint ?? null,
      hasSourceAnalysisRefs: Boolean(clip.audioState?.sourceAnalysisRefs),
      hasProcessedAnalysisRefs: Boolean(clip.audioState?.processedAnalysisRefs),
      hasStemSeparation: Boolean(clip.audioState?.stemSeparation),
      stemCount: clip.audioState?.stemSeparation?.stems.length ?? 0,
      waveformLength: clip.waveform?.length ?? 0,
      waveformChannelLengths: clip.waveformChannels?.map(channel => channel.length) ?? [],
      stemSeparation: clip.audioState?.stemSeparation
        ? {
            mixMode: clip.audioState.stemSeparation.mixMode,
            soloStemId: clip.audioState.stemSeparation.soloStemId ?? null,
            sourceGainDb: clip.audioState.stemSeparation.sourceGainDb ?? 0,
            stems: clip.audioState.stemSeparation.stems.map((stem) => ({
              id: stem.id,
              kind: stem.kind,
              label: stem.label,
              enabled: stem.enabled,
              gainDb: stem.gainDb,
              mediaFileId: stem.mediaFileId ?? null,
              hasWaveform: Boolean(stem.waveform?.length),
              waveformLength: stem.waveform?.length ?? 0,
            })),
          }
        : null,
    }));

  return {
    success: true,
    data: {
      selectedClipIds: Array.from(timelineState.selectedClipIds),
      primarySelectedClipId: timelineState.primarySelectedClipId,
      expandedClipStemLayerIds: Array.from(timelineState.expandedClipStemLayerIds),
      clipStemSeparationJobs: Object.fromEntries(
        Object.entries(timelineState.clipStemSeparationJobs).map(([clipId, job]) => [
          clipId,
          {
            ...job,
            progressPercent: Math.round(Math.max(0, Math.min(1, job.progress)) * 100),
            ageMs: now - job.startedAt,
            updatedAgoMs: now - job.updatedAt,
          },
        ]),
      ),
      clips,
      modelCacheStatus,
      modelCacheError,
      runtimeStemDiagnostics: getRuntimeDiagnostics({ limit: 50, level: 'DEBUG', search: 'stem' }),
      runtimeWarnings: getRuntimeDiagnostics({ limit: 30, level: 'WARN' }),
    },
  };
}

type AudioBenchmarkMode = 'html' | 'webaudio' | 'buffer';

function isAudioBenchmarkMode(value: unknown): value is AudioBenchmarkMode {
  return value === 'html' || value === 'webaudio' || value === 'buffer';
}

async function waitForAudioReady(audio: HTMLAudioElement, timeoutMs = 5000): Promise<void> {
  if (audio.readyState >= 3) return;

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for audio element to become ready.'));
    }, timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('canplaythrough', onReady);
      audio.removeEventListener('error', onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(audio.error?.message || 'Audio element failed to load.'));
    };
    audio.addEventListener('canplay', onReady, { once: true });
    audio.addEventListener('canplaythrough', onReady, { once: true });
    audio.addEventListener('error', onError, { once: true });
    audio.load();
  });
}

function summarizeNumberList(values: number[]): { count: number; avg: number; max: number; min: number } {
  if (values.length === 0) return { count: 0, avg: 0, max: 0, min: 0 };
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    avg: Math.round((sum / values.length) * 100) / 100,
    max: Math.round(Math.max(...values) * 100) / 100,
    min: Math.round(Math.min(...values) * 100) / 100,
  };
}

function estimateByteLength(value: string): number {
  return new Blob([value]).size;
}

function summarizeMediaWaveformPayloads() {
  return useMediaStore.getState().files
    .map((file) => {
      const aggregateLength = file.waveform?.length ?? 0;
      const channelLengths = file.waveformChannels?.map(channel => channel.length) ?? [];
      const totalLength = aggregateLength + channelLengths.reduce((sum, length) => sum + length, 0);
      return {
        id: file.id,
        name: file.name,
        type: file.type,
        waveformStatus: file.waveformStatus ?? null,
        aggregateLength,
        channelLengths,
        totalLength,
        hasAudioProxy: file.hasProxyAudio === true || file.audioProxyStatus === 'ready',
        audioAnalysisRefs: file.audioAnalysisRefs ?? null,
      };
    })
    .filter((entry) => entry.totalLength > 0 || entry.audioAnalysisRefs);
}

function summarizeProxyAudioCache() {
  const cache = proxyFrameCache as unknown as {
    audioCache?: Map<string, HTMLAudioElement>;
    audioLoadingPromises?: Map<string, Promise<HTMLAudioElement | null>>;
    audioBufferCache?: Map<string, AudioBuffer>;
    audioBufferFailed?: Set<string>;
  };
  const mediaFileById = new Map(useMediaStore.getState().files.map((file) => [file.id, file]));
  const audioBuffers = Array.from(cache.audioBufferCache?.entries() ?? []).map(([mediaFileId, buffer]) => {
    const mediaFile = mediaFileById.get(mediaFileId);
    const approximateBytes = buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
    return {
      mediaFileId,
      name: mediaFile?.name ?? mediaFileId,
      duration: Math.round(buffer.duration * 100) / 100,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      frames: buffer.length,
      approximateBytes,
      approximateMb: Math.round((approximateBytes / 1024 / 1024) * 100) / 100,
    };
  });
  const totalAudioBufferBytes = audioBuffers.reduce((sum, entry) => sum + entry.approximateBytes, 0);
  return {
    audioElementCount: cache.audioCache?.size ?? 0,
    audioLoadingCount: cache.audioLoadingPromises?.size ?? 0,
    audioBufferCount: cache.audioBufferCache?.size ?? 0,
    audioBufferFailedCount: cache.audioBufferFailed?.size ?? 0,
    totalAudioBufferApproximateBytes: totalAudioBufferBytes,
    totalAudioBufferApproximateMb: Math.round((totalAudioBufferBytes / 1024 / 1024) * 100) / 100,
    audioBuffers,
  };
}

function summarizePerformanceMemory() {
  const memory = (performance as unknown as {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }).memory;
  if (!memory) return null;
  return {
    usedJSHeapMb: Math.round((memory.usedJSHeapSize / 1024 / 1024) * 100) / 100,
    totalJSHeapMb: Math.round((memory.totalJSHeapSize / 1024 / 1024) * 100) / 100,
    jsHeapLimitMb: Math.round((memory.jsHeapSizeLimit / 1024 / 1024) * 100) / 100,
  };
}

async function measureUiFrameLoop(args: Record<string, unknown> = {}) {
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(500, Math.min(60000, Math.round(args.durationMs)))
    : 5000;
  const expectedFrameMs = 1000 / 60;
  const startedAt = performance.now();
  const frames: Array<{ elapsedMs: number; deltaMs: number }> = [];
  const longTasks: Array<Record<string, unknown>> = [];
  const longAnimationFrames: Array<Record<string, unknown>> = [];
  const beforeCache = summarizeProxyAudioCache();
  const beforeMemory = summarizePerformanceMemory();
  let observer: PerformanceObserver | null = null;
  let animationFrameObserver: PerformanceObserver | null = null;
  let frameId: number | null = null;
  let previousFrameAt: number | null = null;

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({
            name: entry.name,
            startTime: Math.round(entry.startTime * 100) / 100,
            durationMs: Math.round(entry.duration * 100) / 100,
            entryType: entry.entryType,
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      observer = null;
    }

    try {
      animationFrameObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longAnimationFrames.push({
            name: entry.name,
            startTime: Math.round(entry.startTime * 100) / 100,
            durationMs: Math.round(entry.duration * 100) / 100,
            entryType: entry.entryType,
          });
        }
      });
      animationFrameObserver.observe({ entryTypes: ['long-animation-frame'] });
    } catch {
      animationFrameObserver = null;
    }
  }

  try {
    await new Promise<void>((resolve) => {
      const tick = (timestamp: number) => {
        if (previousFrameAt !== null) {
          frames.push({
            elapsedMs: Math.round(timestamp - startedAt),
            deltaMs: Math.round((timestamp - previousFrameAt) * 100) / 100,
          });
        }
        previousFrameAt = timestamp;
        if (timestamp - startedAt >= durationMs) {
          resolve();
          return;
        }
        frameId = window.requestAnimationFrame(tick);
      };
      frameId = window.requestAnimationFrame(tick);
    });
  } finally {
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    observer?.disconnect();
    animationFrameObserver?.disconnect();
  }

  const deltas = frames.map(frame => frame.deltaMs);
  const droppedFrameEstimate = deltas.reduce((sum, delta) => (
    sum + Math.max(0, Math.round(delta / expectedFrameMs) - 1)
  ), 0);
  const slowFrames = frames.filter(frame => frame.deltaMs > expectedFrameMs * 1.75);
  const timelineState = useTimelineStore.getState();
  return {
    success: true,
    data: {
      durationMs,
      frameCount: frames.length,
      estimatedFps: Math.round((frames.length / Math.max(1, durationMs / 1000)) * 100) / 100,
      frameDeltaMs: summarizeNumberList(deltas),
      slowFrameCount: slowFrames.length,
      droppedFrameEstimate,
      longTaskCount: longTasks.length,
      longAnimationFrameCount: longAnimationFrames.length,
      longTasks,
      longAnimationFrames,
      beforeMemory,
      afterMemory: summarizePerformanceMemory(),
      beforeCache,
      afterCache: summarizeProxyAudioCache(),
      page: {
        visibilityState: document.visibilityState,
        hidden: document.hidden,
        hasFocus: document.hasFocus(),
      },
      stemClipCount: timelineState.clips.filter((clip) => clip.audioState?.stemSeparation?.stems.length).length,
      selectedClipIds: Array.from(timelineState.selectedClipIds),
      expandedClipStemLayerIds: Array.from(timelineState.expandedClipStemLayerIds),
      frames: frames.slice(-240),
    },
  };
}

function summarizeElementForDebug(element: Element | null) {
  if (!element) return null;
  const htmlElement = element as HTMLElement;
  const rect = htmlElement.getBoundingClientRect();
  return {
    tagName: htmlElement.tagName.toLowerCase(),
    className: htmlElement.className,
    dataAiId: htmlElement.getAttribute('data-ai-id'),
    dataSectionKind: htmlElement.getAttribute('data-section-kind'),
    clientWidth: htmlElement.clientWidth,
    clientHeight: htmlElement.clientHeight,
    scrollWidth: htmlElement.scrollWidth,
    scrollHeight: htmlElement.scrollHeight,
    scrollLeft: htmlElement.scrollLeft,
    scrollTop: htmlElement.scrollTop,
    transform: getComputedStyle(htmlElement).transform,
    rect: {
      x: Math.round(rect.x * 100) / 100,
      y: Math.round(rect.y * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100,
    },
  };
}

function collectTimelineInteractionSnapshot() {
  const tracks = document.querySelector<HTMLElement>('[data-ai-id="timeline-tracks"]');
  const bodyContent = document.querySelector<HTMLElement>('.timeline-body-content');
  const audioSection = document.querySelector<HTMLElement>('.timeline-track-section[data-section-kind="audio"]');
  const videoSection = document.querySelector<HTMLElement>('.timeline-track-section[data-section-kind="video"]');
  const audioViewport = audioSection?.querySelector<HTMLElement>('.timeline-section-viewport') ?? null;
  const videoViewport = videoSection?.querySelector<HTMLElement>('.timeline-section-viewport') ?? null;
  const audioContent = audioSection?.querySelector<HTMLElement>('.timeline-section-content-row') ?? null;
  const videoContent = videoSection?.querySelector<HTMLElement>('.timeline-section-content-row') ?? null;
  const audioLanes = audioSection?.querySelector<HTMLElement>('.track-lanes-scroll') ?? null;
  const videoLanes = videoSection?.querySelector<HTMLElement>('.track-lanes-scroll') ?? null;
  return {
    tracks: summarizeElementForDebug(tracks),
    bodyContent: summarizeElementForDebug(bodyContent),
    audioSection: summarizeElementForDebug(audioSection),
    videoSection: summarizeElementForDebug(videoSection),
    audioViewport: summarizeElementForDebug(audioViewport),
    videoViewport: summarizeElementForDebug(videoViewport),
    audioContent: summarizeElementForDebug(audioContent),
    videoContent: summarizeElementForDebug(videoContent),
    audioLanes: summarizeElementForDebug(audioLanes),
    videoLanes: summarizeElementForDebug(videoLanes),
    guidedScrollX: tracks?.getAttribute('data-guided-timeline-scroll-x') ?? null,
    zoom: tracks?.getAttribute('data-guided-timeline-zoom') ?? null,
  };
}

function getTimelineInteractionTarget(kind: string, sectionKind: 'audio' | 'video') {
  const section = document.querySelector<HTMLElement>(`.timeline-track-section[data-section-kind="${sectionKind}"]`);
  const bodyContent = document.querySelector<HTMLElement>('.timeline-body-content');
  if (kind === 'vertical-wheel') {
    return section?.querySelector<HTMLElement>('.timeline-section-viewport') ?? section ?? bodyContent;
  }
  if (kind === 'pointer-move') {
    return bodyContent ?? section?.querySelector<HTMLElement>('.timeline-section-tracks') ?? section;
  }
  return section?.querySelector<HTMLElement>('.timeline-section-tracks') ?? bodyContent ?? section;
}

function dispatchTimelineInteractionEvent(
  target: HTMLElement,
  kind: string,
  iteration: number,
  deltaMagnitude: number,
) {
  const rect = target.getBoundingClientRect();
  const direction = Math.floor(iteration / 8) % 2 === 0 ? 1 : -1;
  const clientX = rect.left + Math.max(4, Math.min(rect.width - 4, rect.width * (0.2 + (iteration % 7) * 0.1)));
  const clientY = rect.top + Math.max(4, Math.min(rect.height - 4, rect.height * 0.5));

  if (kind === 'pointer-move') {
    const pointerEvent = new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      pointerId: 997,
      pointerType: 'mouse',
      isPrimary: true,
    });
    target.dispatchEvent(pointerEvent);
    return;
  }

  const horizontal = kind === 'horizontal-wheel' || kind === 'horizontal-trackpad';
  const wheelEvent = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    deltaX: kind === 'horizontal-trackpad' ? direction * deltaMagnitude : 0,
    deltaY: kind === 'horizontal-wheel' || kind === 'vertical-wheel' ? direction * deltaMagnitude : 0,
    shiftKey: kind === 'horizontal-wheel',
  });
  target.dispatchEvent(wheelEvent);
  if (horizontal && !wheelEvent.defaultPrevented && kind === 'horizontal-trackpad') {
    target.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaX: direction * deltaMagnitude,
      deltaY: 0,
    }));
  }
}

async function measureTimelineInteraction(args: Record<string, unknown> = {}) {
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(500, Math.min(60000, Math.round(args.durationMs)))
    : 5000;
  const eventIntervalMs = typeof args.eventIntervalMs === 'number' && Number.isFinite(args.eventIntervalMs)
    ? Math.max(16, Math.min(500, Math.round(args.eventIntervalMs)))
    : 50;
  const deltaMagnitude = typeof args.delta === 'number' && Number.isFinite(args.delta)
    ? Math.max(1, Math.min(2000, Math.round(Math.abs(args.delta))))
    : 140;
  const kind = typeof args.kind === 'string' && args.kind.trim()
    ? args.kind.trim()
    : 'horizontal-wheel';
  const sectionKind = args.sectionKind === 'video' ? 'video' : 'audio';
  const target = getTimelineInteractionTarget(kind, sectionKind);
  if (!target) {
    return {
      success: false,
      error: 'Timeline interaction target not found.',
      data: {
        kind,
        sectionKind,
        snapshot: collectTimelineInteractionSnapshot(),
      },
    };
  }

  const expectedFrameMs = 1000 / 60;
  const startedAt = performance.now();
  const frames: Array<{ elapsedMs: number; deltaMs: number }> = [];
  const longTasks: Array<Record<string, unknown>> = [];
  const longAnimationFrames: Array<Record<string, unknown>> = [];
  const beforeCache = summarizeProxyAudioCache();
  const beforeMemory = summarizePerformanceMemory();
  const beforeSnapshot = collectTimelineInteractionSnapshot();
  let observer: PerformanceObserver | null = null;
  let animationFrameObserver: PerformanceObserver | null = null;
  let frameId: number | null = null;
  let timerId: number | null = null;
  let previousFrameAt: number | null = null;
  let eventCount = 0;

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({
            name: entry.name,
            startTime: Math.round(entry.startTime * 100) / 100,
            durationMs: Math.round(entry.duration * 100) / 100,
            entryType: entry.entryType,
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      observer = null;
    }

    try {
      animationFrameObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longAnimationFrames.push({
            name: entry.name,
            startTime: Math.round(entry.startTime * 100) / 100,
            durationMs: Math.round(entry.duration * 100) / 100,
            entryType: entry.entryType,
          });
        }
      });
      animationFrameObserver.observe({ entryTypes: ['long-animation-frame'] });
    } catch {
      animationFrameObserver = null;
    }
  }

  try {
    timerId = window.setInterval(() => {
      dispatchTimelineInteractionEvent(target, kind, eventCount, deltaMagnitude);
      eventCount += 1;
    }, eventIntervalMs);

    await new Promise<void>((resolve) => {
      const tick = (timestamp: number) => {
        if (previousFrameAt !== null) {
          frames.push({
            elapsedMs: Math.round(timestamp - startedAt),
            deltaMs: Math.round((timestamp - previousFrameAt) * 100) / 100,
          });
        }
        previousFrameAt = timestamp;
        if (timestamp - startedAt >= durationMs) {
          resolve();
          return;
        }
        frameId = window.requestAnimationFrame(tick);
      };
      frameId = window.requestAnimationFrame(tick);
    });
  } finally {
    if (timerId !== null) window.clearInterval(timerId);
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    observer?.disconnect();
    animationFrameObserver?.disconnect();
  }

  const deltas = frames.map(frame => frame.deltaMs);
  const droppedFrameEstimate = deltas.reduce((sum, delta) => (
    sum + Math.max(0, Math.round(delta / expectedFrameMs) - 1)
  ), 0);
  const slowFrames = frames.filter(frame => frame.deltaMs > expectedFrameMs * 1.75);
  const timelineState = useTimelineStore.getState();
  return {
    success: true,
    data: {
      kind,
      sectionKind,
      durationMs,
      eventIntervalMs,
      deltaMagnitude,
      eventCount,
      frameCount: frames.length,
      estimatedFps: Math.round((frames.length / Math.max(1, durationMs / 1000)) * 100) / 100,
      frameDeltaMs: summarizeNumberList(deltas),
      slowFrameCount: slowFrames.length,
      droppedFrameEstimate,
      longTaskCount: longTasks.length,
      longAnimationFrameCount: longAnimationFrames.length,
      longTasks,
      longAnimationFrames,
      beforeMemory,
      afterMemory: summarizePerformanceMemory(),
      beforeCache,
      afterCache: summarizeProxyAudioCache(),
      beforeSnapshot,
      afterSnapshot: collectTimelineInteractionSnapshot(),
      stemClipCount: timelineState.clips.filter((clip) => clip.audioState?.stemSeparation?.stems.length).length,
      selectedClipIds: Array.from(timelineState.selectedClipIds),
      expandedClipStemLayerIds: Array.from(timelineState.expandedClipStemLayerIds),
      target: summarizeElementForDebug(target),
      frames: frames.slice(-240),
    },
  };
}

function collectDockResizeSnapshot() {
  const audioMixer = document.querySelector<HTMLElement>('.audio-mixer-panel');
  const handles = Array.from(document.querySelectorAll<HTMLElement>('.dock-resize-handle'));
  const splits = Array.from(document.querySelectorAll<HTMLElement>('.dock-split')).map((split) => ({
    splitId: split.dataset.splitId ?? null,
    className: split.className,
    rect: summarizeElementForDebug(split)?.rect ?? null,
  }));
  return {
    audioMixer: summarizeElementForDebug(audioMixer),
    handles: handles.map((handle) => summarizeElementForDebug(handle)),
    splits,
    dockLayout: useDockStore.getState().layout,
  };
}

function findDockResizeHandleForDebug(args: Record<string, unknown> = {}): HTMLElement | null {
  const splitId = typeof args.splitId === 'string' && args.splitId.trim()
    ? args.splitId.trim()
    : '';
  if (splitId) {
    const split = document.querySelector<HTMLElement>(`.dock-split[data-split-id="${CSS.escape(splitId)}"]`);
    const handle = split?.querySelector<HTMLElement>(':scope > .dock-resize-handle');
    if (handle) return handle;
  }

  const direction = args.direction === 'horizontal' ? 'horizontal' : 'vertical';
  const handles = Array.from(document.querySelectorAll<HTMLElement>(`.dock-resize-handle.${direction}`));
  if (handles.length === 0) return null;

  const audioMixer = document.querySelector<HTMLElement>('.audio-mixer-panel');
  const audioRect = audioMixer?.getBoundingClientRect();
  if (!audioRect) return handles[0] ?? null;

  return handles
    .map((handle) => {
      const rect = handle.getBoundingClientRect();
      const edgeDistance = direction === 'vertical'
        ? Math.abs(rect.top + rect.height / 2 - audioRect.top)
        : Math.abs(rect.left + rect.width / 2 - audioRect.left);
      return { handle, edgeDistance };
    })
    .sort((left, right) => left.edgeDistance - right.edgeDistance)[0]?.handle ?? null;
}

async function measureDockResizeInteraction(args: Record<string, unknown> = {}) {
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(500, Math.min(60000, Math.round(args.durationMs)))
    : 3500;
  const eventIntervalMs = typeof args.eventIntervalMs === 'number' && Number.isFinite(args.eventIntervalMs)
    ? Math.max(16, Math.min(500, Math.round(args.eventIntervalMs)))
    : 33;
  const deltaMagnitude = typeof args.delta === 'number' && Number.isFinite(args.delta)
    ? Math.max(1, Math.min(800, Math.round(Math.abs(args.delta))))
    : 90;
  const handle = findDockResizeHandleForDebug(args);
  if (!handle) {
    return {
      success: false,
      error: 'Dock resize handle not found.',
      data: {
        snapshot: collectDockResizeSnapshot(),
      },
    };
  }

  const expectedFrameMs = 1000 / 60;
  const startedAt = performance.now();
  const frames: Array<{ elapsedMs: number; deltaMs: number }> = [];
  const longTasks: Array<Record<string, unknown>> = [];
  const longAnimationFrames: Array<Record<string, unknown>> = [];
  const beforeCache = summarizeProxyAudioCache();
  const beforeMemory = summarizePerformanceMemory();
  const beforeSnapshot = collectDockResizeSnapshot();
  const handleRect = handle.getBoundingClientRect();
  const handleIsHorizontal = handle.classList.contains('horizontal');
  const startX = handleRect.left + handleRect.width / 2;
  const startY = handleRect.top + handleRect.height / 2;
  let observer: PerformanceObserver | null = null;
  let animationFrameObserver: PerformanceObserver | null = null;
  let frameId: number | null = null;
  let timerId: number | null = null;
  let previousFrameAt: number | null = null;
  let eventCount = 0;

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({
            name: entry.name,
            startTime: Math.round(entry.startTime * 100) / 100,
            durationMs: Math.round(entry.duration * 100) / 100,
            entryType: entry.entryType,
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      observer = null;
    }

    try {
      animationFrameObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longAnimationFrames.push({
            name: entry.name,
            startTime: Math.round(entry.startTime * 100) / 100,
            durationMs: Math.round(entry.duration * 100) / 100,
            entryType: entry.entryType,
          });
        }
      });
      animationFrameObserver.observe({ entryTypes: ['long-animation-frame'] });
    } catch {
      animationFrameObserver = null;
    }
  }

  const dispatchWindowMouseMove = (clientX: number, clientY: number) => {
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      button: 0,
    }));
  };

  try {
    handle.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX: startX,
      clientY: startY,
      button: 0,
    }));

    timerId = window.setInterval(() => {
      const progress = (eventCount % 24) / 24;
      const wave = Math.sin(progress * Math.PI * 2);
      dispatchWindowMouseMove(
        handleIsHorizontal ? startX + wave * deltaMagnitude : startX,
        handleIsHorizontal ? startY : startY + wave * deltaMagnitude,
      );
      eventCount += 1;
    }, eventIntervalMs);

    await new Promise<void>((resolve) => {
      const tick = (timestamp: number) => {
        if (previousFrameAt !== null) {
          frames.push({
            elapsedMs: Math.round(timestamp - startedAt),
            deltaMs: Math.round((timestamp - previousFrameAt) * 100) / 100,
          });
        }
        previousFrameAt = timestamp;
        if (timestamp - startedAt >= durationMs) {
          resolve();
          return;
        }
        frameId = window.requestAnimationFrame(tick);
      };
      frameId = window.requestAnimationFrame(tick);
    });
  } finally {
    if (timerId !== null) window.clearInterval(timerId);
    dispatchWindowMouseMove(startX, startY);
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      clientX: startX,
      clientY: startY,
      button: 0,
    }));
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    observer?.disconnect();
    animationFrameObserver?.disconnect();
  }

  const deltas = frames.map(frame => frame.deltaMs);
  const droppedFrameEstimate = deltas.reduce((sum, delta) => (
    sum + Math.max(0, Math.round(delta / expectedFrameMs) - 1)
  ), 0);
  const slowFrames = frames.filter(frame => frame.deltaMs > expectedFrameMs * 1.75);
  return {
    success: true,
    data: {
      durationMs,
      eventIntervalMs,
      deltaMagnitude,
      eventCount,
      frameCount: frames.length,
      estimatedFps: Math.round((frames.length / Math.max(1, durationMs / 1000)) * 100) / 100,
      frameDeltaMs: summarizeNumberList(deltas),
      slowFrameCount: slowFrames.length,
      droppedFrameEstimate,
      longTaskCount: longTasks.length,
      longAnimationFrameCount: longAnimationFrames.length,
      longTasks,
      longAnimationFrames,
      beforeMemory,
      afterMemory: summarizePerformanceMemory(),
      beforeCache,
      afterCache: summarizeProxyAudioCache(),
      beforeSnapshot,
      afterSnapshot: collectDockResizeSnapshot(),
      handle: summarizeElementForDebug(handle),
      frames: frames.slice(-240),
    },
  };
}

async function measureIdleMainThread(args: Record<string, unknown> = {}) {
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(500, Math.min(60000, Math.round(args.durationMs)))
    : 10000;
  const sampleIntervalMs = typeof args.sampleIntervalMs === 'number' && Number.isFinite(args.sampleIntervalMs)
    ? Math.max(16, Math.min(1000, Math.round(args.sampleIntervalMs)))
    : 50;
  const timelineState = useTimelineStore.getState();
  const settingsState = useSettingsStore.getState();
  const projectData = projectFileService.getProjectData();
  const stemClips = timelineState.clips.filter((clip) => clip.audioState?.stemSeparation?.stems.length);
  const stemWaveformLengths = stemClips.flatMap((clip) =>
    clip.audioState?.stemSeparation?.stems.map((stem) => ({
      clipId: clip.id,
      label: stem.label,
      waveformLength: stem.waveform?.length ?? 0,
      mediaFileId: stem.mediaFileId ?? null,
    })) ?? []
  );
  const samples: Array<{ elapsedMs: number; gapMs: number }> = [];
  const longTasks: Array<Record<string, unknown>> = [];
  let observer: PerformanceObserver | null = null;
  let timerId: number | null = null;
  const startedAt = performance.now();
  let last = startedAt;

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({
            name: entry.name,
            startTime: Math.round(entry.startTime * 100) / 100,
            durationMs: Math.round(entry.duration * 100) / 100,
            entryType: entry.entryType,
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      observer = null;
    }
  }

  try {
    timerId = window.setInterval(() => {
      const now = performance.now();
      samples.push({
        elapsedMs: Math.round(now - startedAt),
        gapMs: Math.round((now - last) * 100) / 100,
      });
      last = now;
    }, sampleIntervalMs);

    await new Promise((resolve) => window.setTimeout(resolve, durationMs));
  } finally {
    if (timerId !== null) window.clearInterval(timerId);
    observer?.disconnect();
  }

  let stringifyMs = 0;
  let projectJsonBytes = 0;
  if (projectData) {
    const stringifyStartedAt = performance.now();
    const json = JSON.stringify(projectData);
    stringifyMs = performance.now() - stringifyStartedAt;
    projectJsonBytes = estimateByteLength(json);
  }

  const gapValues = samples.map((sample) => sample.gapMs);
  return {
    success: true,
    data: {
      durationMs,
      sampleIntervalMs,
      saveMode: settingsState.saveMode,
      autosaveEnabled: settingsState.autosaveEnabled,
      autosaveInterval: settingsState.autosaveInterval,
      projectOpen: projectFileService.isProjectOpen(),
      projectDirty: projectFileService.hasUnsavedChanges(),
      projectJsonBytes,
      projectStringifyMs: Math.round(stringifyMs * 100) / 100,
      stemClipCount: stemClips.length,
      stemWaveformLengths,
      mediaWaveforms: summarizeMediaWaveformPayloads(),
      sampleGapMs: summarizeNumberList(gapValues),
      overBudgetCount: gapValues.filter((gap) => gap > sampleIntervalMs * 1.75).length,
      longTasks,
      samples: samples.slice(-120),
      runtimeWarnings: getRuntimeDiagnostics({ limit: 40, level: 'WARN' }),
    },
  };
}

type StoreChurnEvent = {
  elapsedMs: number;
  source: string;
  detail?: Record<string, unknown>;
};

function summarizeStemClipState() {
  return useTimelineStore.getState().clips
    .filter((clip) => clip.audioState?.stemSeparation?.stems.length)
    .map((clip) => ({
      id: clip.id,
      name: clip.name,
      mixMode: clip.audioState?.stemSeparation?.mixMode ?? null,
      soloStemId: clip.audioState?.stemSeparation?.soloStemId ?? null,
      stemCount: clip.audioState?.stemSeparation?.stems.length ?? 0,
      stems: clip.audioState?.stemSeparation?.stems.map((stem) => ({
        id: stem.id,
        label: stem.label,
        enabled: stem.enabled !== false,
        gainDb: stem.gainDb ?? 0,
        mediaFileId: stem.mediaFileId ?? null,
        waveformLength: stem.waveform?.length ?? 0,
      })) ?? [],
    }));
}

function createTimelineClipsDebugSignature() {
  return JSON.stringify(useTimelineStore.getState().clips.map((clip) => ({
    id: clip.id,
    trackId: clip.trackId,
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    audioState: clip.audioState
      ? {
          editStackLength: clip.audioState.editStack?.length ?? 0,
          effectStackLength: clip.audioState.effectStack?.length ?? 0,
          stemSeparation: clip.audioState.stemSeparation
            ? {
                activeSetId: clip.audioState.stemSeparation.activeSetId,
                mixMode: clip.audioState.stemSeparation.mixMode,
                soloStemId: clip.audioState.stemSeparation.soloStemId ?? null,
                sourceGainDb: clip.audioState.stemSeparation.sourceGainDb ?? 0,
                stems: clip.audioState.stemSeparation.stems.map((stem) => ({
                  id: stem.id,
                  enabled: stem.enabled !== false,
                  gainDb: stem.gainDb ?? 0,
                  mediaFileId: stem.mediaFileId ?? null,
                })),
              }
            : null,
        }
      : null,
  })));
}

function createMediaPersistedDebugSignature() {
  return JSON.stringify(useMediaStore.getState().files.map((file) => ({
    id: file.id,
    name: file.name,
    type: file.type,
    parentId: file.parentId ?? null,
    projectPath: file.projectPath ?? null,
    filePath: file.filePath ?? null,
    fileHash: file.fileHash ?? null,
    duration: file.duration ?? null,
    proxyStatus: file.proxyStatus ?? null,
    proxyFrameCount: file.proxyFrameCount ?? null,
    proxyFps: file.proxyFps ?? null,
    hasProxyAudio: file.hasProxyAudio === true,
    audioProxyStatus: file.audioProxyStatus ?? null,
    audioProxyStorageKey: file.audioProxyStorageKey ?? null,
    audioAnalysisRefs: file.audioAnalysisRefs ?? null,
    waveformStatus: file.waveformStatus ?? null,
    waveformLength: file.waveform?.length ?? 0,
    waveformChannelLengths: file.waveformChannels?.map(channel => channel.length) ?? [],
  })));
}

function createAudioRuntimeDebugSignature() {
  const state = useTimelineStore.getState() as unknown as {
    runtimeAudioMeters?: unknown;
    clipStemSeparationJobs?: unknown;
  };
  return JSON.stringify({
    runtimeAudioMeters: state.runtimeAudioMeters ?? null,
    clipStemSeparationJobs: state.clipStemSeparationJobs ?? null,
  });
}

function summarizeRuntimeAudioMeters() {
  // Read directly from the runtime audio meter bus (source of truth). The meter
  // shape is preserved; `demand` is added as optional diagnostics.
  const now = performance.now();
  const debug = runtimeAudioMeterBus.getDebugSnapshot();
  const summarizeSnapshot = (meter: import('../../types').AudioMeterSnapshot) => ({
    peakLinear: Math.round(meter.peakLinear * 10000) / 10000,
    rmsLinear: Math.round(meter.rmsLinear * 10000) / 10000,
    peakDb: Math.round(meter.peakDb * 10) / 10,
    rmsDb: Math.round(meter.rmsDb * 10) / 10,
    updatedAgeMs: Math.round(now - meter.updatedAt),
  });
  return {
    master: debug.master ? summarizeSnapshot(debug.master) : null,
    tracks: Object.fromEntries(Object.entries(debug.tracks).map(([trackId, meter]) => [
      trackId,
      summarizeSnapshot(meter),
    ])),
    demand: {
      master: debug.demand.master,
      tracks: debug.demand.tracks,
    },
  };
}

function summarizeDebugStack(stack: string | undefined): string[] {
  if (!stack) return [];
  return stack
    .split('\n')
    .slice(1, 10)
    .map(line => line.trim())
    .filter(Boolean);
}

async function measureStoreChurn(args: Record<string, unknown> = {}) {
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(500, Math.min(60000, Math.round(args.durationMs)))
    : 10000;
  const sampleIntervalMs = typeof args.sampleIntervalMs === 'number' && Number.isFinite(args.sampleIntervalMs)
    ? Math.max(16, Math.min(1000, Math.round(args.sampleIntervalMs)))
    : 50;
  const maxEvents = typeof args.maxEvents === 'number' && Number.isFinite(args.maxEvents)
    ? Math.max(20, Math.min(500, Math.round(args.maxEvents)))
    : 200;

  const startedAt = performance.now();
  const events: StoreChurnEvent[] = [];
  const pushEvent = (source: string, detail?: Record<string, unknown>) => {
    events.push({
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
      source,
      detail,
    });
    if (events.length > maxEvents) {
      events.shift();
    }
  };

  const disposers: Array<() => void> = [];
  const samples: Array<{ elapsedMs: number; gapMs: number; dirty: boolean }> = [];
  const longTasks: Array<Record<string, unknown>> = [];
  let observer: PerformanceObserver | null = null;
  let timerId: number | null = null;
  let last = startedAt;
  let previousTimelineClipsSignature = createTimelineClipsDebugSignature();
  let previousMediaPersistedSignature = createMediaPersistedDebugSignature();
  let previousAudioRuntimeSignature = createAudioRuntimeDebugSignature();

  const projectServiceForPatch = projectFileService as unknown as {
    markDirty: () => void;
    saveProject: () => Promise<boolean>;
  };
  const originalMarkDirty = projectServiceForPatch.markDirty.bind(projectFileService);
  const originalSaveProject = projectServiceForPatch.saveProject.bind(projectFileService);
  let markDirtyCount = 0;
  let saveProjectCount = 0;
  let saveProjectTotalMs = 0;
  let saveProjectMaxMs = 0;

  projectServiceForPatch.markDirty = () => {
    markDirtyCount += 1;
    pushEvent('project.markDirty', {
      dirty: projectFileService.hasUnsavedChanges(),
      stack: summarizeDebugStack(new Error().stack),
    });
    return originalMarkDirty();
  };

  projectServiceForPatch.saveProject = async () => {
    saveProjectCount += 1;
    const saveStartedAt = performance.now();
    pushEvent('project.saveProject.start', { dirty: projectFileService.hasUnsavedChanges() });
    try {
      return await originalSaveProject();
    } finally {
      const duration = performance.now() - saveStartedAt;
      saveProjectTotalMs += duration;
      saveProjectMaxMs = Math.max(saveProjectMaxMs, duration);
      pushEvent('project.saveProject.end', {
        durationMs: Math.round(duration * 100) / 100,
        dirty: projectFileService.hasUnsavedChanges(),
      });
    }
  };

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({
            name: entry.name,
            startTime: Math.round(entry.startTime * 100) / 100,
            durationMs: Math.round(entry.duration * 100) / 100,
            entryType: entry.entryType,
          });
          pushEvent('performance.longtask', {
            durationMs: Math.round(entry.duration * 100) / 100,
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      observer = null;
    }
  }

  disposers.push(useTimelineStore.subscribe(
    state => state.clips,
    (clips) => {
      const nextSignature = createTimelineClipsDebugSignature();
      pushEvent('timeline.clips', {
        count: clips.length,
        signatureChanged: nextSignature !== previousTimelineClipsSignature,
      });
      previousTimelineClipsSignature = nextSignature;
    },
  ));

  disposers.push(useTimelineStore.subscribe(
    state => state.tracks,
    (tracks) => pushEvent('timeline.tracks', { count: tracks.length }),
  ));

  disposers.push(useTimelineStore.subscribe(
    state => (state as unknown as { clipStemSeparationJobs?: unknown }).clipStemSeparationJobs,
    (jobs) => pushEvent('timeline.stemJobs', { keys: Object.keys((jobs ?? {}) as Record<string, unknown>) }),
  ));

  disposers.push(useTimelineStore.subscribe(
    () => createAudioRuntimeDebugSignature(),
    (signature) => {
      pushEvent('timeline.audioRuntime', {
        signatureChanged: signature !== previousAudioRuntimeSignature,
      });
      previousAudioRuntimeSignature = signature;
    },
  ));

  disposers.push(useMediaStore.subscribe(
    state => state.files,
    (files) => {
      const nextSignature = createMediaPersistedDebugSignature();
      pushEvent('media.files', {
        count: files.length,
        signatureChanged: nextSignature !== previousMediaPersistedSignature,
      });
      previousMediaPersistedSignature = nextSignature;
    },
  ));

  try {
    timerId = window.setInterval(() => {
      const now = performance.now();
      samples.push({
        elapsedMs: Math.round(now - startedAt),
        gapMs: Math.round((now - last) * 100) / 100,
        dirty: projectFileService.hasUnsavedChanges(),
      });
      last = now;
    }, sampleIntervalMs);

    await new Promise((resolve) => window.setTimeout(resolve, durationMs));
  } finally {
    if (timerId !== null) window.clearInterval(timerId);
    observer?.disconnect();
    for (const dispose of disposers) {
      dispose();
    }
    projectServiceForPatch.markDirty = originalMarkDirty;
    projectServiceForPatch.saveProject = originalSaveProject;
  }

  const gapValues = samples.map((sample) => sample.gapMs);
  return {
    success: true,
    data: {
      durationMs,
      sampleIntervalMs,
      saveMode: useSettingsStore.getState().saveMode,
      projectDirty: projectFileService.hasUnsavedChanges(),
      markDirtyCount,
      saveProjectCount,
      saveProjectMs: {
        total: Math.round(saveProjectTotalMs * 100) / 100,
        max: Math.round(saveProjectMaxMs * 100) / 100,
        avg: saveProjectCount > 0
          ? Math.round((saveProjectTotalMs / saveProjectCount) * 100) / 100
          : 0,
      },
      stemClips: summarizeStemClipState(),
      mediaWaveforms: summarizeMediaWaveformPayloads(),
      runtimeAudioMeters: summarizeRuntimeAudioMeters(),
      sampleGapMs: summarizeNumberList(gapValues),
      overBudgetCount: gapValues.filter((gap) => gap > sampleIntervalMs * 1.75).length,
      longTasks,
      events,
      samples: samples.slice(-120),
      runtimeWarnings: getRuntimeDiagnostics({ limit: 40, level: 'WARN' }),
    },
  };
}

async function collectAudioBenchmarkSources(args: Record<string, unknown>) {
  const timelineState = useTimelineStore.getState();
  const mediaState = useMediaStore.getState();
  const clipId = typeof args.clipId === 'string' && args.clipId.trim()
    ? args.clipId.trim()
    : timelineState.primarySelectedClipId ?? Array.from(timelineState.selectedClipIds)[0] ?? '';
  const clip = timelineState.clips.find((candidate) => candidate.id === clipId);
  if (!clip) {
    throw new Error(`Clip not found: ${clipId || '(none)'}`);
  }

  const mediaFileById = new Map(mediaState.files.map((file) => [file.id, file]));
  const entries: Array<{ role: string; label: string; mediaFileId: string }> = [];
  const includeSource = args.includeSource !== false;
  const sourceMediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId;
  if (includeSource && sourceMediaFileId) {
    entries.push({ role: 'source', label: clip.name || 'Source', mediaFileId: sourceMediaFileId });
  }

  for (const stem of clip.audioState?.stemSeparation?.stems ?? []) {
    if (!stem.mediaFileId) continue;
    entries.push({ role: 'stem', label: stem.label, mediaFileId: stem.mediaFileId });
  }

  const limit = typeof args.limit === 'number' && Number.isFinite(args.limit)
    ? Math.max(1, Math.floor(args.limit))
    : entries.length;

  const sources = [];
  for (const entry of entries.slice(0, limit)) {
    const mediaFile = mediaFileById.get(entry.mediaFileId);
    if (!mediaFile) continue;

    const storageKey = mediaFile.audioProxyStorageKey || mediaFile.fileHash || mediaFile.id;
    let url = mediaFile.audioProxyUrl || '';
    let revoke = false;
    let source = mediaFile.audioProxyUrl ? 'audioProxyUrl' : '';

    if (!url) {
      const proxyAudio = await projectFileService.getProxyAudio(storageKey);
      if (proxyAudio) {
        url = URL.createObjectURL(proxyAudio);
        revoke = true;
        source = 'projectProxyAudio';
      }
    }

    if (!url && mediaFile.url) {
      url = mediaFile.url;
      source = 'mediaFileUrl';
    }

    if (!url) continue;

    sources.push({
      ...entry,
      mediaFileName: mediaFile.name,
      source,
      url,
      revoke,
    });
  }

  return { clipId: clip.id, clipName: clip.name, sources };
}

async function runAudioElementBenchmark(args: Record<string, unknown> = {}) {
  const mode: AudioBenchmarkMode = isAudioBenchmarkMode(args.mode) ? args.mode : 'html';
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(500, Math.min(15000, Math.round(args.durationMs)))
    : 5000;
  const sampleIntervalMs = typeof args.sampleIntervalMs === 'number' && Number.isFinite(args.sampleIntervalMs)
    ? Math.max(20, Math.min(1000, Math.round(args.sampleIntervalMs)))
    : 100;
  const offsetSeconds = typeof args.offsetSeconds === 'number' && Number.isFinite(args.offsetSeconds)
    ? Math.max(0, args.offsetSeconds)
    : 62;
  const outputGain = typeof args.volume === 'number' && Number.isFinite(args.volume)
    ? Math.max(0, Math.min(1, args.volume))
    : 0.0001;
  const { clipId, clipName, sources } = await collectAudioBenchmarkSources(args);
  if (sources.length === 0) {
    return { success: false, error: 'No playable audio proxy/source URLs found for benchmark.' };
  }

  const audioContext = mode === 'webaudio' || mode === 'buffer' ? new AudioContext() : null;
  const routeNodes: AudioNode[] = [];
  const createdAudios: HTMLAudioElement[] = [];
  const samples: Array<Record<string, unknown>> = [];
  const startedAt = performance.now();
  let timerId: number | null = null;

  try {
    if (audioContext) {
      await audioContext.resume();
    }

    if (mode === 'buffer') {
      const decoded = [];
      for (const source of sources) {
        const response = await fetch(source.url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = await audioContext!.decodeAudioData(arrayBuffer.slice(0));
        decoded.push({ source, buffer });
      }

      const gain = audioContext!.createGain();
      gain.gain.value = outputGain;
      gain.connect(audioContext!.destination);
      const startAtContextTime = audioContext!.currentTime + 0.15;
      for (const item of decoded) {
        const sourceNode = audioContext!.createBufferSource();
        sourceNode.buffer = item.buffer;
        sourceNode.connect(gain);
        sourceNode.start(startAtContextTime, Math.min(offsetSeconds, Math.max(0, item.buffer.duration - 0.1)));
        routeNodes.push(sourceNode);
      }

      const startPerf = performance.now();
      const startContext = audioContext!.currentTime;
      let lastSampleAt = startPerf;
      timerId = window.setInterval(() => {
        const now = performance.now();
        samples.push({
          elapsedMs: Math.round(now - startPerf),
          sampleGapMs: Math.round((now - lastSampleAt) * 100) / 100,
          contextElapsedMs: Math.round((audioContext!.currentTime - startContext) * 1000),
        });
        lastSampleAt = now;
      }, sampleIntervalMs);

      await new Promise((resolve) => window.setTimeout(resolve, durationMs));
    } else {
      const audios = sources.map((source) => {
        const audio = new Audio();
        audio.src = source.url;
        audio.preload = 'auto';
        audio.volume = mode === 'webaudio' ? 1 : outputGain;
        createdAudios.push(audio);
        return { source, audio };
      });

      await Promise.all(audios.map(({ audio }) => waitForAudioReady(audio)));

      if (mode === 'webaudio') {
        for (const { audio } of audios) {
          const mediaNode = audioContext!.createMediaElementSource(audio);
          const gain = audioContext!.createGain();
          gain.gain.value = outputGain;
          mediaNode.connect(gain);
          gain.connect(audioContext!.destination);
          routeNodes.push(mediaNode, gain);
        }
      }

      for (const { audio } of audios) {
        audio.currentTime = Math.min(offsetSeconds, Math.max(0, (Number.isFinite(audio.duration) ? audio.duration : offsetSeconds + 1) - 0.1));
      }

      const playStart = performance.now();
      const playResults = await Promise.all(audios.map(async ({ source, audio }) => {
        const before = performance.now();
        await audio.play();
        return {
          label: source.label,
          startDelayMs: Math.round((performance.now() - before) * 100) / 100,
          readyState: audio.readyState,
        };
      }));
      const startTimes = audios.map(({ audio }) => audio.currentTime);
      let lastSampleAt = playStart;
      timerId = window.setInterval(() => {
        const now = performance.now();
        const times = audios.map(({ audio }) => audio.currentTime);
        const expected = offsetSeconds + ((now - playStart) / 1000);
        const driftsMs = times.map((time) => (time - expected) * 1000);
        const spreadMs = (Math.max(...times) - Math.min(...times)) * 1000;
        samples.push({
          elapsedMs: Math.round(now - playStart),
          sampleGapMs: Math.round((now - lastSampleAt) * 100) / 100,
          spreadMs: Math.round(spreadMs * 100) / 100,
          maxAbsDriftMs: Math.round(Math.max(...driftsMs.map((value) => Math.abs(value))) * 100) / 100,
          times: times.map((time) => Math.round(time * 1000) / 1000),
          driftsMs: driftsMs.map((value) => Math.round(value * 100) / 100),
        });
        lastSampleAt = now;
      }, sampleIntervalMs);

      await new Promise((resolve) => window.setTimeout(resolve, durationMs));
      samples.push({
        elapsedMs: Math.round(performance.now() - playStart),
        finalTimes: audios.map(({ audio }) => Math.round(audio.currentTime * 1000) / 1000),
        startTimes: startTimes.map((time) => Math.round(time * 1000) / 1000),
        playResults,
      });
    }
  } finally {
    if (timerId !== null) window.clearInterval(timerId);
    for (const audio of createdAudios) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    for (const node of routeNodes) {
      try {
        node.disconnect();
      } catch {
        // Ignore cleanup errors in debug tooling.
      }
    }
    if (audioContext && audioContext.state !== 'closed') {
      await audioContext.close().catch(() => {});
    }
    for (const source of sources) {
      if (source.revoke) URL.revokeObjectURL(source.url);
    }
  }

  const sampleGaps = samples
    .map((sample) => typeof sample.sampleGapMs === 'number' ? sample.sampleGapMs : 0)
    .filter((value) => value > 0);
  const spreads = samples
    .map((sample) => typeof sample.spreadMs === 'number' ? sample.spreadMs : 0)
    .filter((value) => value > 0);
  const drifts = samples
    .map((sample) => typeof sample.maxAbsDriftMs === 'number' ? sample.maxAbsDriftMs : 0)
    .filter((value) => value > 0);

  return {
    success: true,
    data: {
      clipId,
      clipName,
      mode,
      durationMs,
      sampleIntervalMs,
      offsetSeconds,
      outputGain,
      sourceCount: sources.length,
      sources: sources.map(({ url: _url, revoke: _revoke, ...source }) => source),
      summary: {
        sampleGapMs: summarizeNumberList(sampleGaps),
        spreadMs: summarizeNumberList(spreads),
        maxAbsDriftMs: summarizeNumberList(drifts),
        longMainThreadGaps: sampleGaps.filter((gap) => gap > sampleIntervalMs * 1.75).length,
      },
      samples: samples.slice(-80),
      elapsedMs: Math.round(performance.now() - startedAt),
    },
  };
}

async function runDebugAction(action: string, args: Record<string, unknown> = {}) {
  const timelineState = useTimelineStore.getState();
  const mediaState = useMediaStore.getState();

  switch (action) {
    case 'measure-idle-main-thread':
      return measureIdleMainThread(args);
    case 'measure-store-churn':
      return measureStoreChurn(args);
    case 'measure-ui-frame-loop':
      return measureUiFrameLoop(args);
    case 'measure-timeline-interaction':
      return measureTimelineInteraction(args);
    case 'measure-dock-resize-interaction':
      return measureDockResizeInteraction(args);
    case 'get-proxy-audio-cache-state':
      return {
        success: true,
        data: {
          memory: summarizePerformanceMemory(),
          proxyAudioCache: summarizeProxyAudioCache(),
        },
      };
    case 'clear-proxy-audio-buffer-cache': {
      const before = summarizeProxyAudioCache();
      proxyFrameCache.clearAudioBufferCache();
      return {
        success: true,
        data: {
          before,
          after: summarizeProxyAudioCache(),
          memory: summarizePerformanceMemory(),
        },
      };
    }
    case 'run-audio-element-benchmark':
      return runAudioElementBenchmark(args);
    case 'get-audio-proxy-state':
      return {
        success: true,
        data: {
          files: mediaState.files.map((file) => ({
            id: file.id,
            name: file.name,
            type: file.type,
            hasAudio: file.hasAudio ?? null,
            hasProxyAudio: file.hasProxyAudio === true,
            audioProxyStatus: file.audioProxyStatus ?? null,
            audioProxyProgress: file.audioProxyProgress ?? null,
            audioProxyStorageKey: file.audioProxyStorageKey ?? file.fileHash ?? file.id,
            hasAudioProxyUrl: Boolean(file.audioProxyUrl),
          })),
          clips: timelineState.clips.map((clip) => ({
            id: clip.id,
            name: clip.name,
            sourceType: clip.source?.type ?? null,
            mediaFileId: clip.source?.mediaFileId ?? clip.mediaFileId ?? null,
          })),
        },
      };
    case 'get-stem-state':
      return collectStemDebugState(args);
    case 'start-stem-separation': {
      const clipId = typeof args.clipId === 'string' && args.clipId.trim()
        ? args.clipId.trim()
        : timelineState.primarySelectedClipId ?? Array.from(timelineState.selectedClipIds)[0] ?? '';
      if (!clipId) {
        return { success: false, error: 'No clipId provided and no clip is selected.' };
      }

      const jobId = await timelineState.startClipStemSeparation(clipId, {
        force: args.force === true,
        modelId: typeof args.modelId === 'string' ? args.modelId : undefined,
      });
      const debugState = await collectStemDebugState({ ...args, clipId });
      return {
        success: jobId !== null,
        data: {
          action,
          clipId,
          jobId,
          debugState: debugState.success ? debugState.data : null,
        },
        ...(jobId === null ? { error: 'Stem separation did not start for this clip.' } : {}),
      };
    }
    case 'cancel-stem-separation': {
      const clipId = typeof args.clipId === 'string' && args.clipId.trim()
        ? args.clipId.trim()
        : timelineState.primarySelectedClipId ?? Array.from(timelineState.selectedClipIds)[0] ?? '';
      if (!clipId) {
        return { success: false, error: 'No clipId provided and no clip is selected.' };
      }

      timelineState.cancelClipStemSeparation(clipId);
      return collectStemDebugState({ ...args, clipId });
    }
    case 'set-clip-stem-solo': {
      const clipId = typeof args.clipId === 'string' && args.clipId.trim()
        ? args.clipId.trim()
        : timelineState.primarySelectedClipId ?? Array.from(timelineState.selectedClipIds)[0] ?? '';
      if (!clipId) {
        return { success: false, error: 'No clipId provided and no clip is selected.' };
      }
      const stemId = typeof args.stemId === 'string' && args.stemId.trim()
        ? args.stemId.trim()
        : null;
      timelineState.setClipStemSolo(clipId, stemId);
      return collectStemDebugState({ ...args, clipId });
    }
    case 'set-clip-stem-layer-open': {
      const clipId = typeof args.clipId === 'string' && args.clipId.trim()
        ? args.clipId.trim()
        : timelineState.primarySelectedClipId ?? Array.from(timelineState.selectedClipIds)[0] ?? '';
      if (!clipId) {
        return { success: false, error: 'No clipId provided and no clip is selected.' };
      }
      timelineState.setClipStemLayerDropdownOpen(clipId, args.open !== false);
      return collectStemDebugState({ ...args, clipId });
    }
    case 'sync-clip-stem-copies': {
      const clipId = typeof args.clipId === 'string' && args.clipId.trim()
        ? args.clipId.trim()
        : timelineState.primarySelectedClipId ?? Array.from(timelineState.selectedClipIds)[0] ?? '';
      if (!clipId) {
        return { success: false, error: 'No clipId provided and no clip is selected.' };
      }
      const copyCount = timelineState.syncClipStemSeparationCopies(clipId);
      const debugState = await collectStemDebugState({ ...args, clipId });
      return {
        success: true,
        data: {
          action,
          clipId,
          copyCount,
          debugState: debugState.success ? debugState.data : null,
        },
      };
    }
    case 'set-slot-view': {
      const progress = typeof args.progress === 'number' ? args.progress : 1;
      timelineState.setSlotGridProgress(progress);
      return { success: true, data: { action, progress } };
    }
    case 'activate-slot': {
      const compositionId = typeof args.compositionId === 'string' ? args.compositionId : null;
      const layerIndex = typeof args.layerIndex === 'number' ? args.layerIndex : 0;
      const select = args.select !== false;
      const open = args.open === true;
      const play = args.play === true;
      if (!compositionId) {
        return { success: false, error: 'Missing compositionId' };
      }

      const composition = mediaState.compositions.find((entry) => entry.id === compositionId);
      if (!composition) {
        return { success: false, error: `Composition not found: ${compositionId}` };
      }

      mediaState.ensureSlotClipSettings(compositionId, composition.duration);
      if (select) {
        mediaState.selectSlotComposition(compositionId);
      }
      if (open) {
        mediaState.openCompositionTab(compositionId, { skipAnimation: true });
      }
      mediaState.activateOnLayer(compositionId, layerIndex);
      if (play) {
        layerPlaybackManager.playLayer(layerIndex);
      }

      return { success: true, data: { action, compositionId, layerIndex, select, open, play } };
    }
    case 'play-slot-layer': {
      const layerIndex = typeof args.layerIndex === 'number' ? args.layerIndex : 0;
      layerPlaybackManager.playLayer(layerIndex);
      return { success: true, data: { action, layerIndex } };
    }
    case 'pause-slot-layer': {
      const layerIndex = typeof args.layerIndex === 'number' ? args.layerIndex : 0;
      layerPlaybackManager.pauseLayer(layerIndex);
      return { success: true, data: { action, layerIndex } };
    }
    case 'stop-slot-layer': {
      const layerIndex = typeof args.layerIndex === 'number' ? args.layerIndex : 0;
      layerPlaybackManager.stopLayer(layerIndex);
      return { success: true, data: { action, layerIndex } };
    }
    case 'deactivate-all-slots': {
      mediaState.deactivateAllLayers();
      mediaState.selectSlotComposition(null);
      return { success: true, data: { action } };
    }
    case 'load-project-path': {
      const projectPath = typeof args.path === 'string' ? args.path : '';
      if (!projectPath) {
        return { success: false, error: 'Missing path' };
      }

      const loaded = await projectFileService.loadProject(projectPath);
      if (!loaded) {
        return { success: false, error: `Failed to load project: ${projectPath}` };
      }

      await loadProjectToStores();
      return {
        success: true,
        data: {
          action,
          projectPath,
          projectName: projectFileService.getProjectData()?.name ?? null,
        },
      };
    }
    case 'reload-page': {
      window.location.reload();
      return { success: true, data: { action } };
    }
    default:
      return { success: false, error: `Unknown debug action: ${action}` };
  }
}

if (import.meta.hot) {
  let presenceIntervalId: number | null = null;
  const sendPresence = () => {
    import.meta.hot!.send('ai-tools:presence', {
      tabId,
      visibilityState: typeof document !== 'undefined' ? document.visibilityState : 'hidden',
      hasFocus: typeof document !== 'undefined' && typeof document.hasFocus === 'function'
        ? document.hasFocus()
        : false,
    });
  };

  sendPresence();
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', sendPresence);
    window.addEventListener('blur', sendPresence);
    document.addEventListener('visibilitychange', sendPresence);
    presenceIntervalId = window.setInterval(sendPresence, 10000);
  }

  import.meta.hot.dispose(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', sendPresence);
      window.removeEventListener('blur', sendPresence);
      document.removeEventListener('visibilitychange', sendPresence);
      if (presenceIntervalId !== null) {
        window.clearInterval(presenceIntervalId);
      }
    }
  });

  import.meta.hot.on('ai-tools:execute', async (data: {
    requestId: string;
    tool: string;
    args: Record<string, unknown>;
    options?: unknown;
    targetTabId?: string | null;
  }) => {
    if (data.targetTabId && data.targetTabId !== tabId) {
      return;
    }

    try {
      const delayMs = getTabPriorityDelayMs(data.targetTabId === tabId);
      if (delayMs < 0) {
        return;
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      let result: unknown;
      if (data.tool === '_list') {
        result = { success: true, data: AI_TOOLS };
      } else if (data.tool === '_status') {
        result = { success: true, data: getQuickTimelineSummary() };
      } else if (data.tool === '_inspectGuided') {
        result = inspectGuidedBridgeTool(data.args);
      } else {
        const execution = resolveBridgeToolExecution(data.args, data.options);
        result = await executeAITool(data.tool, execution.args, 'devBridge', execution.options);
      }

      import.meta.hot!.send('ai-tools:result', {
        requestId: data.requestId,
        result,
      });
    } catch (error: unknown) {
      import.meta.hot!.send('ai-tools:result', {
        requestId: data.requestId,
        result: { success: false, error: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  import.meta.hot.on('debug-state:request', async (data: {
    requestId: string;
    scope?: string;
    targetTabId?: string | null;
  }) => {
    if (data.targetTabId && data.targetTabId !== tabId) {
      return;
    }

    try {
      const delayMs = getTabPriorityDelayMs(data.targetTabId === tabId);
      if (delayMs < 0) {
        return;
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      import.meta.hot!.send('debug-state:result', {
        requestId: data.requestId,
        result: { success: true, data: collectDebugState(data.scope) },
      });
    } catch (error: unknown) {
      import.meta.hot!.send('debug-state:result', {
        requestId: data.requestId,
        result: { success: false, error: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  import.meta.hot.on('debug-action:request', async (data: {
    requestId: string;
    action: string;
    args?: Record<string, unknown>;
    targetTabId?: string | null;
  }) => {
    if (data.targetTabId && data.targetTabId !== tabId) {
      return;
    }

    try {
      const delayMs = getTabPriorityDelayMs(data.targetTabId === tabId);
      if (delayMs < 0) {
        return;
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      import.meta.hot!.send('debug-action:result', {
        requestId: data.requestId,
        result: await runDebugAction(data.action, data.args ?? {}),
      });
    } catch (error: unknown) {
      import.meta.hot!.send('debug-action:result', {
        requestId: data.requestId,
        result: { success: false, error: error instanceof Error ? error.message : String(error) },
      });
    }
  });
}

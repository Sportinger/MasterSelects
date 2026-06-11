import { useTimelineStore } from '../../../../../stores/timeline';
import { useMediaStore } from '../../../../../stores/mediaStore';
import { useSettingsStore } from '../../../../../stores/settingsStore';
import { projectFileService } from '../../../../projectFileService';
import { getRuntimeDiagnostics } from '../../../../runtimeDiagnostics';
import { proxyFrameCache } from '../../../../proxyFrameCache';
import { layerBuilder } from '../../../../layerBuilder';
import { audioRoutingManager } from '../../../../audioRoutingManager';
import { engine } from '../../../../../engine/WebGPUEngine';
import { createFrameContext, getClipTimeInfo } from '../../../../layerBuilder/FrameContext';
import { createLiveAudioRouteSettings, getTrackAudioMuted } from '../../../../audio/audioGraphRouteSettings';
import { canUseStemBufferMixer } from '../../../../layerBuilder/audioTrackStemSyncModel';
import { getStemBufferMixerPumpDebugSnapshot } from '../../../../layerBuilder/audioTrackStemBufferMixers';
import { getStemBufferMixerDebugSnapshot } from '../../../../layerBuilder/audioTrackStemBufferMixerSessions';

function routeHasEq(eqGains: readonly number[] | undefined): boolean {
  return eqGains?.some(gain => Math.abs(gain) > 0.01) ?? false;
}

export function summarizeSourceBufferMixerEligibility() {
  const ctx = createFrameContext();
  const timelineState = useTimelineStore.getState();
  const activeClipIds = new Set(ctx.clipsAtTime.map((clip) => clip.id));
  const mediaFileById = new Map(useMediaStore.getState().files.map((file) => [file.id, file]));
  const cache = proxyFrameCache as unknown as {
    audioCache?: Map<string, HTMLAudioElement>;
    audioBufferCache?: Map<string, AudioBuffer>;
    audioBufferLoadState?: {
      loading?: Set<string>;
      failed?: Set<string>;
      retryTime?: Map<string, number>;
      nextAllowedWarmAt?: Map<string, number>;
    };
  };

  const entries = ctx.audioTracks.flatMap((track) => {
    const trackClips = ctx.clipsAtTime.filter((clip) => clip.trackId === track.id);
    return trackClips.map((clip) => {
      const sourceMediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId ?? null;
      const timeInfo = getClipTimeInfo(ctx, clip);
      const routeSettings = createLiveAudioRouteSettings({
        clip,
        track,
        masterAudioState: ctx.masterAudioState,
        interpolatedClipEffects: ctx.getInterpolatedEffects(clip.id, timeInfo.clipLocalTime),
        sourceTime: timeInfo.sourceTime,
      });
      const routeAllowed = canUseStemBufferMixer(routeSettings, timeInfo.absSpeed) && timeInfo.speed > 0;
      const mediaFile = sourceMediaFileId ? mediaFileById.get(sourceMediaFileId) : undefined;
      const audioElement = sourceMediaFileId
        ? cache.audioCache?.get(sourceMediaFileId) ?? null
        : null;
      const buffer = sourceMediaFileId
        ? cache.audioBufferCache?.get(sourceMediaFileId) ?? null
        : null;
      const retryAt = sourceMediaFileId
        ? cache.audioBufferLoadState?.retryTime?.get(sourceMediaFileId)
        : undefined;
      const warmAt = sourceMediaFileId
        ? cache.audioBufferLoadState?.nextAllowedWarmAt?.get(sourceMediaFileId)
        : undefined;
      const reasons = [
        !ctx.isPlaying ? 'not-playing' : null,
        ctx.isDraggingPlayhead ? 'dragging-playhead' : null,
        !sourceMediaFileId ? 'missing-media-file-id' : null,
        getTrackAudioMuted(track) ? 'track-muted' : null,
        routeSettings.muted ? 'route-muted' : null,
        Math.abs(timeInfo.absSpeed - 1) > 0.001 ? 'non-1x-speed' : null,
        timeInfo.speed <= 0 ? 'reverse-or-zero-speed' : null,
        Math.abs(routeSettings.pan) > 0.001 ? 'pan-active' : null,
        routeHasEq(routeSettings.eqGains) ? 'track-or-clip-eq-active' : null,
        routeHasEq(routeSettings.master.eqGains) ? 'master-eq-active' : null,
        routeSettings.processors.length > 0 ? 'track-or-clip-processors-active' : null,
        routeSettings.master.processors.length > 0 ? 'master-processors-active' : null,
        routeAllowed ? null : 'route-not-buffer-mixer-compatible',
        buffer ? null : 'buffer-not-cached',
      ].filter(Boolean);

      return {
        trackId: track.id,
        trackName: track.name,
        clipId: clip.id,
        clipName: clip.name,
        sourceType: clip.source?.type ?? null,
        sourceMediaFileId,
        mediaName: mediaFile?.name ?? null,
        active: activeClipIds.has(clip.id),
        routeAllowed,
        canUseSourceBufferMixer: Boolean(ctx.isPlaying && !ctx.isDraggingPlayhead && sourceMediaFileId && routeAllowed),
        hasCachedBuffer: Boolean(buffer),
        bufferMb: buffer
          ? Math.round((buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT / 1024 / 1024) * 100) / 100
          : 0,
        hasProxyAudioElement: Boolean(audioElement),
        audioReadyState: audioElement?.readyState ?? null,
        audioSrcKind: audioElement?.currentSrc || audioElement?.src ? (
          (audioElement.currentSrc || audioElement.src).startsWith('blob:') ? 'blob' : 'other'
        ) : null,
        bufferLoading: sourceMediaFileId ? cache.audioBufferLoadState?.loading?.has(sourceMediaFileId) === true : false,
        bufferFailed: sourceMediaFileId ? cache.audioBufferLoadState?.failed?.has(sourceMediaFileId) === true : false,
        retryInMs: typeof retryAt === 'number' ? Math.max(0, Math.round(retryAt - performance.now())) : null,
        warmInMs: typeof warmAt === 'number' ? Math.max(0, Math.round(warmAt - performance.now())) : null,
        route: {
          pan: Math.round(routeSettings.pan * 1000) / 1000,
          eqActive: routeHasEq(routeSettings.eqGains),
          processorCount: routeSettings.processors.length,
          masterEqActive: routeHasEq(routeSettings.master.eqGains),
          masterProcessorCount: routeSettings.master.processors.length,
        },
        time: {
          speed: Math.round(timeInfo.speed * 1000) / 1000,
          absSpeed: Math.round(timeInfo.absSpeed * 1000) / 1000,
          clipTime: Math.round(timeInfo.clipTime * 1000) / 1000,
          sourceTime: Math.round(timeInfo.sourceTime * 1000) / 1000,
        },
        reasons,
      };
    });
  });

  return {
    isPlaying: ctx.isPlaying,
    storeIsPlaying: timelineState.isPlaying,
    isDraggingPlayhead: ctx.isDraggingPlayhead,
    playheadPosition: Math.round(ctx.playheadPosition * 1000) / 1000,
    audioTrackCount: ctx.audioTracks.length,
    activeAudioClipCount: entries.length,
    audioBufferCount: cache.audioBufferCache?.size ?? 0,
    audioElementCount: cache.audioCache?.size ?? 0,
    sourceBufferMixer: getStemBufferMixerDebugSnapshot(),
    sourceBufferMixerPump: getStemBufferMixerPumpDebugSnapshot(),
    entries,
  };
}

export function summarizeNumberList(values: number[]): { count: number; avg: number; max: number; min: number } {
  if (values.length === 0) return { count: 0, avg: 0, max: 0, min: 0 };
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: values.length,
    avg: Math.round((sum / values.length) * 100) / 100,
    max: Math.round(Math.max(...values) * 100) / 100,
    min: Math.round(Math.min(...values) * 100) / 100,
  };
}

function roundTiming(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : null;
}

export function summarizeLongAnimationFrameEntry(entry: PerformanceEntry, startedAt: number): Record<string, unknown> {
  const detail = entry as PerformanceEntry & {
    blockingDuration?: number;
    renderStart?: number;
    styleAndLayoutStart?: number;
    scripts?: Array<{
      duration?: number;
      executionStart?: number;
      forcedStyleAndLayoutDuration?: number;
      pauseDuration?: number;
      sourceURL?: string;
      sourceFunctionName?: string;
      invoker?: string;
      invokerType?: string;
    }>;
  };
  const scripts = Array.isArray(detail.scripts)
    ? detail.scripts
      .map(script => ({
        durationMs: roundTiming(script.duration),
        executionStartMs: roundTiming(typeof script.executionStart === 'number' ? script.executionStart - startedAt : undefined),
        forcedStyleAndLayoutMs: roundTiming(script.forcedStyleAndLayoutDuration),
        pauseMs: roundTiming(script.pauseDuration),
        sourceURL: typeof script.sourceURL === 'string' ? script.sourceURL.slice(-160) : null,
        sourceFunctionName: script.sourceFunctionName ?? null,
        invoker: script.invoker ?? null,
        invokerType: script.invokerType ?? null,
      }))
      .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))
      .slice(0, 8)
    : [];

  return {
    name: entry.name,
    startTime: roundTiming(entry.startTime - startedAt),
    durationMs: roundTiming(entry.duration),
    blockingDurationMs: roundTiming(detail.blockingDuration),
    renderStartMs: roundTiming(typeof detail.renderStart === 'number' ? detail.renderStart - startedAt : undefined),
    styleAndLayoutStartMs: roundTiming(typeof detail.styleAndLayoutStart === 'number' ? detail.styleAndLayoutStart - startedAt : undefined),
    entryType: entry.entryType,
    scriptCount: Array.isArray(detail.scripts) ? detail.scripts.length : 0,
    scripts,
  };
}

function estimateByteLength(value: string): number {
  return new Blob([value]).size;
}

export function summarizeMediaWaveformPayloads() {
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

export function summarizeProxyAudioCache() {
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

export function summarizePerformanceMemory() {
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

export async function measureUiFrameLoop(args: Record<string, unknown> = {}) {
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
  let timeoutId: number | null = null;
  let previousFrameAt: number | null = null;
  let timedOutByWallClock = false;

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
          longAnimationFrames.push(summarizeLongAnimationFrameEntry(entry, startedAt));
        }
      });
      animationFrameObserver.observe({ entryTypes: ['long-animation-frame'] });
    } catch {
      animationFrameObserver = null;
    }
  }

  try {
    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      timeoutId = window.setTimeout(() => {
        timedOutByWallClock = true;
        finish();
      }, durationMs + 1000);
      const tick = (timestamp: number) => {
        if (resolved) return;
        if (previousFrameAt !== null) {
          frames.push({
            elapsedMs: Math.round(timestamp - startedAt),
            deltaMs: Math.round((timestamp - previousFrameAt) * 100) / 100,
          });
        }
        previousFrameAt = timestamp;
        if (timestamp - startedAt >= durationMs) {
          finish();
          return;
        }
        frameId = window.requestAnimationFrame(tick);
      };
      frameId = window.requestAnimationFrame(tick);
    });
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
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
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
      timedOutByWallClock,
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
      frames: frames.slice(-240),
    },
  };
}

export async function measurePlaybackFrameLoop(args: Record<string, unknown> = {}) {
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(500, Math.min(15000, Math.round(args.durationMs)))
    : 3000;
  const suppressPlayheadStoreUpdates = args.suppressPlayheadStoreUpdates === true;
  const suppressAudioSync = args.suppressAudioSync === true;
  const suppressRuntimeAudioMeters = args.suppressRuntimeAudioMeters === true;
  const suppressAudioOutput = args.suppressAudioOutput === true;
  const suppressAudioRoutingContext = args.suppressAudioRoutingContext === true;
  const suppressLivePlayhead = args.suppressLivePlayhead === true;
  const suppressLivePlayheadLoop = args.suppressLivePlayheadLoop === true;
  const suppressPlaybackLoop = args.suppressPlaybackLoop === true;
  const suppressEngineRenderLoop = args.suppressEngineRenderLoop === true;
  const leavePlaying = args.leavePlaying === true;
  const timelineStore = useTimelineStore.getState();
  const wasPlaying = timelineStore.isPlaying;
  const storeApi = useTimelineStore as unknown as {
    setState: (partial: unknown, replace?: unknown) => void;
  };
  const originalSetState = storeApi.setState;
  const originalUpdateRuntimeAudioMeter = timelineStore.updateRuntimeAudioMeter;
  const originalUpdateRuntimeAudioMeters = timelineStore.updateRuntimeAudioMeters;
  const originalSyncAudioElements = layerBuilder.syncAudioElements.bind(layerBuilder);
  let suppressedPlayheadStoreUpdates = 0;
  let passedStoreUpdates = 0;
  let suppressedAudioSyncCalls = 0;
  let audioSyncCalls = 0;
  let audioSyncTotalMs = 0;
  let audioSyncMaxMs = 0;
  let setStateCalls = 0;
  let setStateTotalMs = 0;
  let setStateMaxMs = 0;
  let playheadSetStateCalls = 0;
  let playheadSetStateTotalMs = 0;
  let playheadSetStateMaxMs = 0;
  let suppressedRuntimeAudioMeterUpdates = 0;
  let suppressedAudioOutputStopCalled = false;
  let suppressedAudioRoutingContextDisposed = false;
  let runtimeAudioMeterUpdateCalls = 0;
  let runtimeAudioMeterUpdateEntries = 0;
  let runtimeAudioMeterUpdateTotalMs = 0;
  let runtimeAudioMeterUpdateMaxMs = 0;
  const hiddenPlayheads: Array<{ element: HTMLElement; visibility: string }> = [];
  const debugWindow = window as typeof window & {
    __MS_DISABLE_LIVE_PLAYHEAD__?: boolean;
    __MS_DISABLE_PLAYBACK_LOOP__?: boolean;
  };
  const previousLivePlayheadDebugFlag = debugWindow.__MS_DISABLE_LIVE_PLAYHEAD__;
  const previousPlaybackLoopDebugFlag = debugWindow.__MS_DISABLE_PLAYBACK_LOOP__;
  let engineRenderLoopStopped = false;

  storeApi.setState = (partial: unknown, replace?: unknown) => {
    const isPlayheadOnlyUpdate = Boolean(
      partial &&
      typeof partial === 'object' &&
      !Array.isArray(partial) &&
      Object.keys(partial as Record<string, unknown>).length === 1 &&
      Object.prototype.hasOwnProperty.call(partial, 'playheadPosition')
    );
    if (suppressPlayheadStoreUpdates && isPlayheadOnlyUpdate && useTimelineStore.getState().isPlaying) {
      suppressedPlayheadStoreUpdates += 1;
      return;
    }
    const startedAt = performance.now();
    try {
      passedStoreUpdates += 1;
      originalSetState(partial, replace);
    } finally {
      const elapsed = performance.now() - startedAt;
      setStateCalls += 1;
      setStateTotalMs += elapsed;
      setStateMaxMs = Math.max(setStateMaxMs, elapsed);
      if (isPlayheadOnlyUpdate) {
        playheadSetStateCalls += 1;
        playheadSetStateTotalMs += elapsed;
        playheadSetStateMaxMs = Math.max(playheadSetStateMaxMs, elapsed);
      }
    }
  };
  if (!suppressAudioSync && !suppressAudioOutput) {
    layerBuilder.syncAudioElements = () => {
      const startedAt = performance.now();
      try {
        return originalSyncAudioElements();
      } finally {
        const elapsed = performance.now() - startedAt;
        audioSyncCalls += 1;
        audioSyncTotalMs += elapsed;
        audioSyncMaxMs = Math.max(audioSyncMaxMs, elapsed);
      }
    };
  } else {
    layerBuilder.syncAudioElements = () => {
      suppressedAudioSyncCalls += 1;
    };
  }
  if (suppressRuntimeAudioMeters) {
    originalSetState({
      updateRuntimeAudioMeter: () => {
        suppressedRuntimeAudioMeterUpdates += 1;
      },
      updateRuntimeAudioMeters: (entries: readonly unknown[]) => {
        suppressedRuntimeAudioMeterUpdates += entries.length;
      },
    });
  } else {
    originalSetState({
      updateRuntimeAudioMeter: (...updateArgs: Parameters<typeof originalUpdateRuntimeAudioMeter>) => {
        const startedAt = performance.now();
        try {
          return originalUpdateRuntimeAudioMeter(...updateArgs);
        } finally {
          const elapsed = performance.now() - startedAt;
          runtimeAudioMeterUpdateCalls += 1;
          runtimeAudioMeterUpdateEntries += 1;
          runtimeAudioMeterUpdateTotalMs += elapsed;
          runtimeAudioMeterUpdateMaxMs = Math.max(runtimeAudioMeterUpdateMaxMs, elapsed);
        }
      },
      updateRuntimeAudioMeters: (...updateArgs: Parameters<typeof originalUpdateRuntimeAudioMeters>) => {
        const startedAt = performance.now();
        try {
          return originalUpdateRuntimeAudioMeters(...updateArgs);
        } finally {
          const elapsed = performance.now() - startedAt;
          runtimeAudioMeterUpdateCalls += 1;
          runtimeAudioMeterUpdateEntries += updateArgs[0]?.length ?? 0;
          runtimeAudioMeterUpdateTotalMs += elapsed;
          runtimeAudioMeterUpdateMaxMs = Math.max(runtimeAudioMeterUpdateMaxMs, elapsed);
        }
      },
    });
  }
  if (suppressAudioOutput) {
    const privateLayerBuilder = layerBuilder as unknown as {
      audioTrackSyncManager?: {
        stopAllAudioPlayback?: () => void;
      };
    };
    privateLayerBuilder.audioTrackSyncManager?.stopAllAudioPlayback?.();
    suppressedAudioOutputStopCalled = true;
  }
  if (suppressAudioRoutingContext) {
    audioRoutingManager.dispose();
    suppressedAudioRoutingContextDisposed = true;
  }
  if (suppressLivePlayhead) {
    document.querySelectorAll<HTMLElement>('[data-ai-id="timeline-playhead"]').forEach((element) => {
      hiddenPlayheads.push({ element, visibility: element.style.visibility });
      element.style.visibility = 'hidden';
    });
  }
  if (suppressPlaybackLoop) {
    debugWindow.__MS_DISABLE_PLAYBACK_LOOP__ = true;
  }
  if (suppressLivePlayheadLoop) {
    debugWindow.__MS_DISABLE_LIVE_PLAYHEAD__ = true;
  }
  if (suppressEngineRenderLoop) {
    engine.stop();
    engineRenderLoopStopped = true;
  }

  try {
    if (!wasPlaying) {
      await useTimelineStore.getState().play();
      await new Promise(resolve => window.setTimeout(resolve, 400));
    }
    const result = await measureUiFrameLoop({ durationMs });
    return {
      ...result,
      data: {
        ...result.data,
        suppressPlayheadStoreUpdates,
        suppressAudioSync,
        suppressRuntimeAudioMeters,
        suppressAudioOutput,
        suppressAudioRoutingContext,
        suppressLivePlayhead,
        suppressLivePlayheadLoop,
        suppressPlaybackLoop,
        suppressEngineRenderLoop,
        suppressedPlayheadStoreUpdates,
        suppressedAudioSyncCalls,
        audioSyncCalls,
        audioSyncTotalMs: Math.round(audioSyncTotalMs * 100) / 100,
        audioSyncMaxMs: Math.round(audioSyncMaxMs * 100) / 100,
        audioSyncAvgMs: audioSyncCalls > 0
          ? Math.round((audioSyncTotalMs / audioSyncCalls) * 100) / 100
          : 0,
        setStateCalls,
        setStateTotalMs: Math.round(setStateTotalMs * 100) / 100,
        setStateMaxMs: Math.round(setStateMaxMs * 100) / 100,
        setStateAvgMs: setStateCalls > 0
          ? Math.round((setStateTotalMs / setStateCalls) * 100) / 100
          : 0,
        playheadSetStateCalls,
        playheadSetStateTotalMs: Math.round(playheadSetStateTotalMs * 100) / 100,
        playheadSetStateMaxMs: Math.round(playheadSetStateMaxMs * 100) / 100,
        playheadSetStateAvgMs: playheadSetStateCalls > 0
          ? Math.round((playheadSetStateTotalMs / playheadSetStateCalls) * 100) / 100
          : 0,
        suppressedRuntimeAudioMeterUpdates,
        runtimeAudioMeterUpdateCalls,
        runtimeAudioMeterUpdateEntries,
        runtimeAudioMeterUpdateTotalMs: Math.round(runtimeAudioMeterUpdateTotalMs * 100) / 100,
        runtimeAudioMeterUpdateMaxMs: Math.round(runtimeAudioMeterUpdateMaxMs * 100) / 100,
        runtimeAudioMeterUpdateAvgMs: runtimeAudioMeterUpdateCalls > 0
          ? Math.round((runtimeAudioMeterUpdateTotalMs / runtimeAudioMeterUpdateCalls) * 100) / 100
          : 0,
        suppressedAudioOutputStopCalled,
        suppressedAudioRoutingContextDisposed,
        engineRenderLoopStopped,
        passedStoreUpdates,
        startedPlaying: !wasPlaying,
        endedPlaying: useTimelineStore.getState().isPlaying,
      },
    };
  } finally {
    if (engineRenderLoopStopped) {
      engine.getRenderLoop()?.start();
    }
    if (suppressPlaybackLoop) {
      debugWindow.__MS_DISABLE_PLAYBACK_LOOP__ = previousPlaybackLoopDebugFlag;
    }
    if (suppressLivePlayheadLoop) {
      debugWindow.__MS_DISABLE_LIVE_PLAYHEAD__ = previousLivePlayheadDebugFlag;
    }
    for (const { element, visibility } of hiddenPlayheads) {
      element.style.visibility = visibility;
    }
    originalSetState({
      updateRuntimeAudioMeter: originalUpdateRuntimeAudioMeter,
      updateRuntimeAudioMeters: originalUpdateRuntimeAudioMeters,
    });
    storeApi.setState = originalSetState;
    layerBuilder.syncAudioElements = originalSyncAudioElements;
    if (!wasPlaying && !leavePlaying) {
      useTimelineStore.getState().pause();
    }
  }
}

function getUsefulStackLine(stack: string): string {
  const lines = stack
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => line.includes('/src/') || line.includes('\\src\\') || line.includes('localhost:5173'))
    ?? lines[1]
    ?? lines[0]
    ?? 'unknown';
}

export async function measureRafCallbacks(args: Record<string, unknown> = {}) {
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(500, Math.min(10000, Math.round(args.durationMs)))
    : 3000;
  const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  const originalCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  const startedAt = performance.now();
  const callbacks = new Map<string, {
    name: string;
    stackLine: string;
    count: number;
    totalMs: number;
    maxMs: number;
    slowCount: number;
  }>();
  const handles = new Map<number, string>();

  function record(name: string, stackLine: string, duration: number): void {
    const key = `${name} ${stackLine}`;
    const current = callbacks.get(key) ?? {
      name,
      stackLine,
      count: 0,
      totalMs: 0,
      maxMs: 0,
      slowCount: 0,
    };
    current.count += 1;
    current.totalMs += duration;
    current.maxMs = Math.max(current.maxMs, duration);
    if (duration >= 8) current.slowCount += 1;
    callbacks.set(key, current);
  }

  window.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
    const name = callback.name || '(anonymous)';
    const stackLine = getUsefulStackLine(new Error().stack ?? '');
    let handle = 0;
    handle = originalRequestAnimationFrame((timestamp) => {
      handles.delete(handle);
      const callbackStartedAt = performance.now();
      try {
        callback(timestamp);
      } finally {
        record(name, stackLine, performance.now() - callbackStartedAt);
      }
    });
    handles.set(handle, `${name} ${stackLine}`);
    return handle;
  }) as typeof window.requestAnimationFrame;

  window.cancelAnimationFrame = ((handle: number): void => {
    handles.delete(handle);
    originalCancelAnimationFrame(handle);
  }) as typeof window.cancelAnimationFrame;

  try {
    await new Promise(resolve => window.setTimeout(resolve, durationMs));
  } finally {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  }

  const entries = Array.from(callbacks.values())
    .map((entry) => ({
      ...entry,
      totalMs: Math.round(entry.totalMs * 100) / 100,
      avgMs: Math.round((entry.totalMs / Math.max(1, entry.count)) * 100) / 100,
      maxMs: Math.round(entry.maxMs * 100) / 100,
    }))
    .sort((left, right) => right.totalMs - left.totalMs);

  return {
    success: true,
    data: {
      durationMs,
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
      callbackCount: entries.reduce((sum, entry) => sum + entry.count, 0),
      activeHandlesAtRestore: handles.size,
      entries: entries.slice(0, 24),
    },
  };
}

export async function measureScheduledCallbacks(args: Record<string, unknown> = {}) {
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(500, Math.min(10000, Math.round(args.durationMs)))
    : 3000;
  const startPlayback = args.startPlayback === true;
  const leavePlaying = args.leavePlaying === true;
  const originalSetInterval = window.setInterval.bind(window);
  const originalSetTimeout = window.setTimeout.bind(window);
  const originalRequestIdleCallback = window.requestIdleCallback?.bind(window);
  const startedAt = performance.now();
  const callbacks = new Map<string, {
    kind: string;
    stackLine: string;
    count: number;
    totalMs: number;
    maxMs: number;
    slowCount: number;
  }>();
  const wasPlaying = useTimelineStore.getState().isPlaying;

  function record(kind: string, stackLine: string, duration: number): void {
    const key = `${kind} ${stackLine}`;
    const current = callbacks.get(key) ?? {
      kind,
      stackLine,
      count: 0,
      totalMs: 0,
      maxMs: 0,
      slowCount: 0,
    };
    current.count += 1;
    current.totalMs += duration;
    current.maxMs = Math.max(current.maxMs, duration);
    if (duration >= 8) current.slowCount += 1;
    callbacks.set(key, current);
  }

  window.setInterval = ((handler: TimerHandler, timeout?: number, ...handlerArgs: unknown[]): number => {
    if (typeof handler !== 'function') {
      return originalSetInterval(handler, timeout, ...handlerArgs);
    }
    const stackLine = getUsefulStackLine(new Error().stack ?? '');
    return originalSetInterval((...callbackArgs: unknown[]) => {
      const callbackStartedAt = performance.now();
      try {
        handler(...callbackArgs);
      } finally {
        record('setInterval', stackLine, performance.now() - callbackStartedAt);
      }
    }, timeout, ...handlerArgs);
  }) as typeof window.setInterval;

  window.setTimeout = ((handler: TimerHandler, timeout?: number, ...handlerArgs: unknown[]): number => {
    if (typeof handler !== 'function') {
      return originalSetTimeout(handler, timeout, ...handlerArgs);
    }
    const stackLine = getUsefulStackLine(new Error().stack ?? '');
    return originalSetTimeout((...callbackArgs: unknown[]) => {
      const callbackStartedAt = performance.now();
      try {
        handler(...callbackArgs);
      } finally {
        record('setTimeout', stackLine, performance.now() - callbackStartedAt);
      }
    }, timeout, ...handlerArgs);
  }) as typeof window.setTimeout;

  if (originalRequestIdleCallback) {
    window.requestIdleCallback = ((callback: IdleRequestCallback, options?: IdleRequestOptions): number => {
      const stackLine = getUsefulStackLine(new Error().stack ?? '');
      return originalRequestIdleCallback((deadline) => {
        const callbackStartedAt = performance.now();
        try {
          callback(deadline);
        } finally {
          record('requestIdleCallback', stackLine, performance.now() - callbackStartedAt);
        }
      }, options);
    }) as typeof window.requestIdleCallback;
  }

  try {
    if (startPlayback && !wasPlaying) {
      await useTimelineStore.getState().play();
    }
    await new Promise(resolve => window.setTimeout(resolve, durationMs));
  } finally {
    window.setInterval = originalSetInterval;
    window.setTimeout = originalSetTimeout;
    if (originalRequestIdleCallback) {
      window.requestIdleCallback = originalRequestIdleCallback;
    }
    if (startPlayback && !wasPlaying && !leavePlaying) {
      useTimelineStore.getState().pause();
    }
  }

  const entries = Array.from(callbacks.values())
    .map((entry) => ({
      ...entry,
      totalMs: Math.round(entry.totalMs * 100) / 100,
      avgMs: Math.round((entry.totalMs / Math.max(1, entry.count)) * 100) / 100,
      maxMs: Math.round(entry.maxMs * 100) / 100,
    }))
    .sort((left, right) => right.totalMs - left.totalMs);

  return {
    success: true,
    data: {
      durationMs,
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
      startedPlayback: startPlayback && !wasPlaying,
      endedPlaying: useTimelineStore.getState().isPlaying,
      callbackCount: entries.reduce((sum, entry) => sum + entry.count, 0),
      entries: entries.slice(0, 32),
    },
  };
}

export async function measureIdleMainThread(args: Record<string, unknown> = {}) {
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

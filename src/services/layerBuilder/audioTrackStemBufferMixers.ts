import type { ClipAudioStemLayer, TimelineClip } from '../../types';
import { proxyFrameCache } from '../proxyFrameCache';
import { dbToLinearGain } from './audioTrackElementUtils';
import type { AudioTrackStemLayerBufferCache } from './audioTrackStemLayerBuffers';
import {
  createStemBufferMixerSession,
  publishStemBufferMixerMeter,
  publishStemBufferMixerMeters,
  recordStemBufferMixerLifecycle,
  setStemBufferMixerMasterClock,
  stopStemBufferMixerSession,
  updateStemBufferMixerGains,
} from './audioTrackStemBufferMixerSessions';
import {
  STEM_MIXER_BUFFER_SET_MAX_BYTES,
  STEM_MIXER_METER_INTERVAL_MS,
  STEM_MIXER_RESTART_DRIFT_SECONDS,
  STEM_MIXER_START_DELAY_SECONDS,
  STEM_SOURCE_LAYER_ID,
  canUseStemBufferMixer,
  createStemBufferCacheKey,
  estimateStemLayerBytes,
  type ClipStemSeparationState,
  type StemBufferMixerLayer,
  type StemBufferMixerSession,
  type StemBufferMixerSyncOptions,
} from './audioTrackStemSyncModel';

type AudioTrackStemBufferMixerManagerOptions = {
  getClipSourceMediaFileId: (clip: TimelineClip) => string | undefined;
  markRuntimeActive: () => void;
  stemLayerBuffers: AudioTrackStemLayerBufferCache;
};

const stemBufferMixerPumpDebugState = {
  ensureCalls: 0,
  ensureSkippedExisting: 0,
  ensureSkippedNoWindow: 0,
  scheduledAt: 0,
  firedAt: 0,
  tickCount: 0,
  emptyTickCount: 0,
  publishTickCount: 0,
  lastKnownSessionCount: 0,
  timerActive: false,
  lastError: null as string | null,
  fallbackSinglePublishCount: 0,
};

export function getStemBufferMixerPumpDebugSnapshot() {
  return {
    ...stemBufferMixerPumpDebugState,
    scheduledAgeMs: stemBufferMixerPumpDebugState.scheduledAt > 0
      ? Math.round(performance.now() - stemBufferMixerPumpDebugState.scheduledAt)
      : null,
    firedAgeMs: stemBufferMixerPumpDebugState.firedAt > 0
      ? Math.round(performance.now() - stemBufferMixerPumpDebugState.firedAt)
      : null,
  };
}

export class AudioTrackStemBufferMixerManager {
  private stemBufferMixerContext: AudioContext | null = null;
  private stemBufferMixers = new Map<string, StemBufferMixerSession>();
  private meterTimerId: number | null = null;
  private getClipSourceMediaFileId: (clip: TimelineClip) => string | undefined;
  private markRuntimeActive: () => void;
  private stemLayerBuffers: AudioTrackStemLayerBufferCache;

  constructor(options: AudioTrackStemBufferMixerManagerOptions) {
    this.getClipSourceMediaFileId = options.getClipSourceMediaFileId;
    this.markRuntimeActive = options.markRuntimeActive;
    this.stemLayerBuffers = options.stemLayerBuffers;
  }

  canUseForStemSet(
    stemSeparation: ClipStemSeparationState | undefined,
    audibleStemLayers: readonly ClipAudioStemLayer[],
  ): boolean {
    if (!stemSeparation || audibleStemLayers.length === 0) return false;
    return estimateStemLayerBytes(stemSeparation, audibleStemLayers.length) <= STEM_MIXER_BUFFER_SET_MAX_BYTES;
  }

  canUseRoute(options: StemBufferMixerSyncOptions): boolean {
    return canUseStemBufferMixer(options.routeSettings, options.timeInfo.absSpeed) && options.timeInfo.speed > 0;
  }

  canUseRouteSettings(options: StemBufferMixerSyncOptions['routeSettings'], absSpeed: number, speed: number): boolean {
    return canUseStemBufferMixer(options, absSpeed) && speed > 0;
  }

  hasRuntime(): boolean {
    return this.stemBufferMixers.size > 0 || this.stemBufferMixerContext !== null;
  }

  sync(options: StemBufferMixerSyncOptions): number {
    const {
      clip,
      stemSeparation,
      audibleStemLayers,
      shouldUseSourceAudio,
      sourceGain,
      routeSettings,
      timeInfo,
      effectiveVolume,
      trackMuted,
      meterTrackId,
      canBeMaster,
    } = options;

    if (audibleStemLayers.length === 0 || !this.canUseRoute(options)) {
      this.stop(clip.id);
      return 0;
    }

    const desiredLayers = this.buildDesiredLayers(
      clip,
      stemSeparation,
      audibleStemLayers,
      shouldUseSourceAudio,
      sourceGain,
      effectiveVolume,
      trackMuted,
    );
    if (desiredLayers.length === 0 || (desiredLayers.length === 1 && desiredLayers[0]?.id === STEM_SOURCE_LAYER_ID)) {
      this.stop(clip.id);
      return 0;
    }
    this.markRuntimeActive();

    const { buffers, layers, missingRequiredLayer } = this.resolveReadyLayers(clip.id, desiredLayers);
    if (missingRequiredLayer || layers.length === 0 || (layers.length === 1 && layers[0]?.id === STEM_SOURCE_LAYER_ID)) {
      this.stop(clip.id);
      return 0;
    }

    const key = JSON.stringify({
      clipId: clip.id,
      activeSetId: stemSeparation.activeSetId,
      layers: layers.map(layer => [layer.id, layer.stemLayer ? createStemBufferCacheKey(layer.stemLayer) : layer.mediaFileId]),
    });
    const context = this.getStemBufferMixerContext();
    if (context.state === 'suspended') void context.resume();

    const current = this.stemBufferMixers.get(clip.id);
    const restartDriftSeconds = this.getRestartDriftSeconds(current, key, context, timeInfo.clipTime);
    const reused = this.tryReuseCurrentMixer(current, key, context, layers, clip, timeInfo, routeSettings.master.volume, canBeMaster, restartDriftSeconds);
    if (reused !== null) return reused;

    return this.startMixerSession(clip, context, key, layers, buffers, timeInfo, routeSettings.master.volume, meterTrackId, canBeMaster, Boolean(current), restartDriftSeconds);
  }

  syncSource(options: {
    clip: TimelineClip;
    mediaFileId: string;
    buffer: AudioBuffer;
    routeSettings: StemBufferMixerSyncOptions['routeSettings'];
    timeInfo: StemBufferMixerSyncOptions['timeInfo'];
    effectiveVolume: number;
    sourceGain: number;
    trackMuted: boolean;
    meterTrackId: string;
    canBeMaster: boolean;
  }): number {
    const {
      clip,
      mediaFileId,
      buffer,
      routeSettings,
      timeInfo,
      effectiveVolume,
      sourceGain,
      trackMuted,
      meterTrackId,
      canBeMaster,
    } = options;
    if (trackMuted || effectiveVolume <= 0 || !this.canUseRouteSettings(routeSettings, timeInfo.absSpeed, timeInfo.speed)) {
      this.stop(clip.id);
      return 0;
    }
    this.markRuntimeActive();

    const layer: StemBufferMixerLayer = {
      id: STEM_SOURCE_LAYER_ID,
      mediaFileId,
      gain: effectiveVolume * sourceGain,
      required: true,
    };
    const layers = [layer];
    const buffers = new Map<string, AudioBuffer>([[STEM_SOURCE_LAYER_ID, buffer]]);
    const key = JSON.stringify({ clipId: clip.id, source: mediaFileId });
    const context = this.getStemBufferMixerContext();
    if (context.state === 'suspended') void context.resume();

    const current = this.stemBufferMixers.get(clip.id);
    const restartDriftSeconds = this.getRestartDriftSeconds(current, key, context, timeInfo.clipTime);
    const reused = this.tryReuseCurrentMixer(current, key, context, layers, clip, timeInfo, routeSettings.master.volume, canBeMaster, restartDriftSeconds);
    if (reused !== null) return reused;

    return this.startMixerSession(clip, context, key, layers, buffers, timeInfo, routeSettings.master.volume, meterTrackId, canBeMaster, Boolean(current), restartDriftSeconds);
  }

  stop(clipId: string): void {
    const session = this.stemBufferMixers.get(clipId);
    if (!session) return;
    stopStemBufferMixerSession(session);
    this.stemBufferMixers.delete(clipId);
    this.stopMeterPumpIfIdle();
    recordStemBufferMixerLifecycle({
      action: 'stop',
      clipId,
      sources: session.sourceCount,
    });
  }

  stopAll(): void {
    for (const clipId of Array.from(this.stemBufferMixers.keys())) this.stop(clipId);
  }

  stopInactiveMixers(knownClipIds: Set<string>, activeClipIds: Set<string>, isPlaying: boolean): void {
    for (const clipId of Array.from(this.stemBufferMixers.keys())) {
      if (!knownClipIds.has(clipId) || !activeClipIds.has(clipId) || !isPlaying) this.stop(clipId);
    }
  }

  requestStemLayerBuffer(layer: ClipAudioStemLayer): void {
    this.markRuntimeActive();
    void this.stemLayerBuffers.ensure(layer);
  }

  releaseIdleRuntime(onCloseError: (error: unknown) => void): void {
    this.stopAll();
    this.stopMeterPump();
    const context = this.stemBufferMixerContext;
    this.stemBufferMixerContext = null;
    if (context && context.state !== 'closed') {
      void context.close().catch(onCloseError);
    }
  }

  private ensureMeterPump(): void {
    stemBufferMixerPumpDebugState.ensureCalls += 1;
    stemBufferMixerPumpDebugState.lastKnownSessionCount = this.stemBufferMixers.size;
    if (typeof window === 'undefined') {
      stemBufferMixerPumpDebugState.ensureSkippedNoWindow += 1;
      stemBufferMixerPumpDebugState.timerActive = false;
      return;
    }
    if (this.meterTimerId !== null) {
      stemBufferMixerPumpDebugState.ensureSkippedExisting += 1;
      stemBufferMixerPumpDebugState.timerActive = true;
      return;
    }
    const tick = () => {
      stemBufferMixerPumpDebugState.firedAt = performance.now();
      stemBufferMixerPumpDebugState.tickCount += 1;
      this.meterTimerId = null;
      stemBufferMixerPumpDebugState.timerActive = false;
      stemBufferMixerPumpDebugState.lastKnownSessionCount = this.stemBufferMixers.size;
      if (this.stemBufferMixers.size === 0) {
        stemBufferMixerPumpDebugState.emptyTickCount += 1;
        return;
      }
      stemBufferMixerPumpDebugState.publishTickCount += 1;
      try {
        publishStemBufferMixerMeters(this.stemBufferMixers.values());
      } catch (error) {
        stemBufferMixerPumpDebugState.lastError = error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
        for (const session of this.stemBufferMixers.values()) {
          publishStemBufferMixerMeter(session, true);
          stemBufferMixerPumpDebugState.fallbackSinglePublishCount += 1;
        }
      } finally {
        this.ensureMeterPump();
      }
    };
    stemBufferMixerPumpDebugState.scheduledAt = performance.now();
    stemBufferMixerPumpDebugState.timerActive = true;
    this.meterTimerId = window.setTimeout(tick, STEM_MIXER_METER_INTERVAL_MS);
  }

  private stopMeterPumpIfIdle(): void {
    if (this.stemBufferMixers.size === 0) {
      this.stopMeterPump();
    }
  }

  private stopMeterPump(): void {
    if (this.meterTimerId === null || typeof window === 'undefined') return;
    window.clearTimeout(this.meterTimerId);
    this.meterTimerId = null;
    stemBufferMixerPumpDebugState.timerActive = false;
  }

  private buildDesiredLayers(
    clip: TimelineClip,
    stemSeparation: ClipStemSeparationState,
    audibleStemLayers: ClipAudioStemLayer[],
    shouldUseSourceAudio: boolean,
    sourceGain: number,
    effectiveVolume: number,
    trackMuted: boolean,
  ): StemBufferMixerLayer[] {
    const sourceMediaFileId = this.getClipSourceMediaFileId(clip);
    const audibleStemIds = new Set(audibleStemLayers.map(stem => stem.id));
    const desiredLayers: StemBufferMixerLayer[] = [];
    const sourceIsAudible = shouldUseSourceAudio && !trackMuted;
    if (sourceMediaFileId && sourceIsAudible) {
      desiredLayers.push({ id: STEM_SOURCE_LAYER_ID, mediaFileId: sourceMediaFileId, gain: effectiveVolume * sourceGain, required: true });
    }
    for (const stem of stemSeparation.stems) {
      const stemIsAudible = audibleStemIds.has(stem.id) && !trackMuted;
      if (!stemIsAudible) continue;
      desiredLayers.push({ id: stem.id, stemLayer: stem, gain: effectiveVolume * dbToLinearGain(stem.gainDb), required: true });
    }
    return desiredLayers;
  }

  private resolveReadyLayers(clipId: string, desiredLayers: StemBufferMixerLayer[]): {
    buffers: Map<string, AudioBuffer>;
    layers: StemBufferMixerLayer[];
    missingRequiredLayer: boolean;
  } {
    const buffers = new Map<string, AudioBuffer>();
    const layers: StemBufferMixerLayer[] = [];
    const current = this.stemBufferMixers.get(clipId);
    let missingRequiredLayer = false;
    for (const layer of desiredLayers) {
      const buffer = this.getCachedStemMixerLayerBuffer(layer);
      if (!buffer) {
        this.requestStemMixerLayerBuffer(layer);
        if (layer.required) missingRequiredLayer = true;
        continue;
      }
      if (current && !layer.required && !current.gains.has(layer.id)) continue;
      buffers.set(layer.id, buffer);
      layers.push(layer);
    }
    return { buffers, layers, missingRequiredLayer };
  }

  private tryReuseCurrentMixer(
    current: StemBufferMixerSession | undefined,
    key: string,
    context: AudioContext,
    layers: StemBufferMixerLayer[],
    clip: TimelineClip,
    timeInfo: StemBufferMixerSyncOptions['timeInfo'],
    masterVolume: number,
    canBeMaster: boolean,
    restartDriftSeconds: number | null,
  ): number | null {
    if (current?.key !== key || current.context !== context) return null;
    if (restartDriftSeconds === null || Math.abs(restartDriftSeconds) > STEM_MIXER_RESTART_DRIFT_SECONDS) return null;
    updateStemBufferMixerGains(current, layers, masterVolume);
    if (canBeMaster) setStemBufferMixerMasterClock(current, clip, timeInfo);
    return current.sourceCount;
  }

  private startMixerSession(
    clip: TimelineClip,
    context: AudioContext,
    key: string,
    layers: StemBufferMixerLayer[],
    buffers: Map<string, AudioBuffer>,
    timeInfo: StemBufferMixerSyncOptions['timeInfo'],
    masterVolume: number,
    meterTrackId: string,
    canBeMaster: boolean,
    hadCurrentSession: boolean,
    restartDriftSeconds: number | null,
  ): number {
    this.stop(clip.id);
    const startAt = context.currentTime + STEM_MIXER_START_DELAY_SECONDS;
    const startOffset = Math.max(0, timeInfo.clipTime + STEM_MIXER_START_DELAY_SECONDS);
    const session = createStemBufferMixerSession({
      clipId: clip.id,
      context,
      key,
      layers,
      buffers,
      startAt,
      startOffset,
      masterVolume,
      meterTrackId,
    });
    if (!session) return 0;
    this.stemBufferMixers.set(clip.id, session);
    this.ensureMeterPump();
    updateStemBufferMixerGains(session, layers, masterVolume);
    if (canBeMaster) setStemBufferMixerMasterClock(session, clip, timeInfo);
    recordStemBufferMixerLifecycle({
      action: hadCurrentSession ? 'restart' : 'start',
      clipId: clip.id,
      sources: session.sourceCount,
      driftMs: restartDriftSeconds === null ? 0 : Math.round(restartDriftSeconds * 1000),
    });
    publishStemBufferMixerMeter(session, true);
    return session.sourceCount;
  }

  private getRestartDriftSeconds(current: StemBufferMixerSession | undefined, key: string, context: AudioContext, clipTime: number): number | null {
    if (current?.key !== key || current.context !== context) return null;
    return (current.getSourceTime() ?? clipTime) - clipTime;
  }

  private getCachedStemMixerLayerBuffer(layer: StemBufferMixerLayer): AudioBuffer | null {
    if (layer.stemLayer) return this.stemLayerBuffers.getCached(layer.stemLayer);
    return layer.mediaFileId ? proxyFrameCache.getCachedAudioBuffer(layer.mediaFileId) : null;
  }

  private requestStemMixerLayerBuffer(layer: StemBufferMixerLayer): void {
    if (!layer.stemLayer) {
      // sync() runs on the playback path. Source media buffers are an
      // optimization for the stem mixer; missing ones fall back to media/proxy
      // elements instead of starting decodeAudioData while playback is active.
      return;
    }
    this.markRuntimeActive();
    void this.stemLayerBuffers.ensure(layer.stemLayer);
  }

  private getStemBufferMixerContext(): AudioContext {
    if (!this.stemBufferMixerContext || this.stemBufferMixerContext.state === 'closed') {
      this.stemBufferMixerContext = new AudioContext();
    }
    return this.stemBufferMixerContext;
  }

}

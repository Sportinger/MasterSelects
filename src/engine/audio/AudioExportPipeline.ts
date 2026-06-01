/**
 * AudioExportPipeline - Orchestrates the complete audio export process
 *
 * Coordinates:
 * 1. AudioExtractor - Decode audio from files
 * 2. TimeStretchProcessor - Handle speed/pitch changes
 * 3. AudioEffectRenderer - Apply EQ and volume
 * 4. AudioMixer - Mix all tracks
 * 5. AudioEncoder - Encode to AAC
 *
 * Returns encoded audio chunks ready for muxing with video
 */

import { Logger } from '../../services/logger';
import { AudioExtractor, audioExtractor } from './AudioExtractor';
import { AudioEncoderWrapper, type EncodedAudioResult } from './AudioEncoder';
import { AudioMixer, type AudioTrackData } from './AudioMixer';
import { renderAudioGraph } from './AudioGraphRenderer';
import type { AudioGraphEffectPlanStep, AudioGraphJsonValue, AudioGraphRenderPlan } from './AudioGraphTypes';
import { AudioEffectRenderer } from './AudioEffectRenderer';
import { getAudioEffect } from './AudioEffectRegistry';
import { dbToLinearGain, finiteNumber } from './audioMath';
import { ClipAudioRenderService, type ClipAudioRenderProgress } from '../../services/audio/ClipAudioRenderService';
import { renderMidiClipToBuffer } from './MidiClipRenderer';
import { getGmSampleBank } from './GmSampleBank';
import {
  audioGraphPlanStepsToEffectInstances,
} from '../../services/audio/audioGraphRouteSettings';
import { analyzeAudioBufferLoudnessSummary } from '../../services/audio/LoudnessEnvelopeGenerator';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { proxyFrameCache } from '../../services/proxyFrameCache';
import type { AudioEffectInstance, Effect, MasterAudioState, TimelineClip, TimelineTrack, Keyframe } from '../../types';

const log = Logger.create('AudioExportPipeline');
const MAX_EXPORT_EFFECT_TAIL_SECONDS = 30;

export interface AudioExportSettings {
  sampleRate: number;       // 44100 or 48000
  bitrate: number;          // 128000 - 320000
  normalize: boolean;       // Peak normalize output
}

export interface AudioExportProgress {
  phase: 'extracting' | 'processing' | 'effects' | 'mixing' | 'encoding' | 'complete';
  percent: number;
  currentClip?: string;
  message?: string;
}

export type AudioExportProgressCallback = (progress: AudioExportProgress) => void;

function clampExportTailSeconds(seconds: number): number {
  return Math.max(0, Math.min(MAX_EXPORT_EFFECT_TAIL_SECONDS, seconds));
}

function getParamNumber(params: Record<string, unknown> | undefined, key: string, fallback: number): number {
  return finiteNumber(params?.[key], fallback);
}

function getEffectTailSeconds(descriptorId: string, params?: Record<string, unknown>): number {
  const descriptor = getAudioEffect(descriptorId);
  const descriptorTail = finiteNumber(descriptor?.tailSeconds, 0);

  if (descriptorId === 'audio-reverb') {
    return clampExportTailSeconds(Math.max(descriptorTail, getParamNumber(params, 'decaySeconds', 0)));
  }

  if (descriptorId === 'audio-delay') {
    const delaySeconds = getParamNumber(params, 'delayMs', 0) / 1000;
    const feedback = Math.max(0, Math.min(0.95, getParamNumber(params, 'feedback', 0)));
    const repeats = feedback > 0.001
      ? Math.ceil(Math.log(0.001) / Math.log(feedback))
      : 1;
    return clampExportTailSeconds(Math.max(descriptorTail, delaySeconds * Math.max(1, repeats)));
  }

  return clampExportTailSeconds(descriptorTail);
}

function getEffectStackTailSeconds(effectStack: readonly AudioEffectInstance[] | undefined): number {
  return clampExportTailSeconds((effectStack ?? []).reduce((sum, effect) => {
    const flags = effect as AudioEffectInstance & { disabled?: boolean; bypassed?: boolean };
    if (effect.enabled === false || flags.disabled === true || flags.bypassed === true) return sum;
    return sum + getEffectTailSeconds(effect.descriptorId, effect.params as Record<string, unknown> | undefined);
  }, 0));
}

function getLegacyEffectTailSeconds(effects: readonly Effect[] | undefined): number {
  return clampExportTailSeconds((effects ?? []).reduce((sum, effect) => {
    if (effect.enabled === false) return sum;
    return sum + getEffectTailSeconds(effect.type, effect.params as Record<string, unknown> | undefined);
  }, 0));
}

function getPlanTailSeconds(effectChain: readonly AudioGraphEffectPlanStep[] | undefined): number {
  return clampExportTailSeconds((effectChain ?? []).reduce((sum, effect) => (
    sum + getEffectTailSeconds(effect.descriptorId, effect.params as Record<string, AudioGraphJsonValue>)
  ), 0));
}

function getClipExportTailSeconds(
  clip: TimelineClip,
  track: TimelineTrack | undefined,
  masterAudioState?: MasterAudioState,
): number {
  return clampExportTailSeconds(
    getEffectStackTailSeconds(clip.audioState?.effectStack) +
    getLegacyEffectTailSeconds(clip.effects) +
    getEffectStackTailSeconds(track?.audioState?.effectStack) +
    getEffectStackTailSeconds(masterAudioState?.effectStack)
  );
}

function createAudioBufferLike(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
  const maybeWindow = globalThis as typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextCtor = globalThis.AudioContext ?? maybeWindow.webkitAudioContext;
  if (AudioContextCtor) {
    const context = new AudioContextCtor();
    const createBuffer = (context as AudioContext & { createBuffer?: BaseAudioContext['createBuffer'] }).createBuffer;
    if (typeof createBuffer === 'function') {
      const buffer = createBuffer.call(context, numberOfChannels, Math.max(1, length), sampleRate);
      void context.close();
      return buffer;
    }
    void context.close();
  }

  const channelData = Array.from({ length: numberOfChannels }, () => new Float32Array(Math.max(1, length)));
  return {
    numberOfChannels,
    sampleRate,
    length: Math.max(1, length),
    duration: Math.max(1, length) / sampleRate,
    getChannelData: (channelIndex: number) => channelData[channelIndex] ?? channelData[0],
  } as unknown as AudioBuffer;
}

function appendSilence(buffer: AudioBuffer, tailSeconds: number): AudioBuffer {
  const tailSamples = Math.max(0, Math.ceil(clampExportTailSeconds(tailSeconds) * buffer.sampleRate));
  if (tailSamples <= 0) return buffer;

  const extended = createAudioBufferLike(buffer.numberOfChannels, buffer.length + tailSamples, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    extended.getChannelData(channel).set(buffer.getChannelData(channel));
  }
  return extended;
}

export class AudioExportPipeline {
  private extractor: AudioExtractor;
  private encoder: AudioEncoderWrapper | null = null;
  private mixer: AudioMixer;
  private clipAudioRenderer: ClipAudioRenderService;
  private graphEffectRenderer: AudioEffectRenderer;
  private settings: AudioExportSettings;
  private cancelled = false;

  constructor(settings?: Partial<AudioExportSettings>) {
    this.settings = {
      sampleRate: settings?.sampleRate ?? 48000,
      bitrate: settings?.bitrate ?? 256000,
      normalize: settings?.normalize ?? false,
    };

    this.extractor = audioExtractor;
    this.mixer = new AudioMixer({
      sampleRate: this.settings.sampleRate,
      normalize: this.settings.normalize,
    });
    this.clipAudioRenderer = new ClipAudioRenderService({
      extractor: this.extractor,
    });
    this.graphEffectRenderer = new AudioEffectRenderer();
  }

  /**
   * Export all audio from timeline
   * @param startTime - Export start time
   * @param endTime - Export end time
   * @param onProgress - Progress callback
   * @returns Encoded audio result with chunks for muxing
   */
  async exportAudio(
    startTime: number,
    endTime: number,
    onProgress?: AudioExportProgressCallback
  ): Promise<EncodedAudioResult | null> {
    this.cancelled = false;

    const { clips, tracks, clipKeyframes, masterAudioState } = useTimelineStore.getState();
    const duration = endTime - startTime;

    log.info(`Starting export: ${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s (${duration.toFixed(2)}s)`);

    // 1. Find all clips with audio in the export range
    const audioClips = AudioExportPipeline.getClipsWithAudio(clips, tracks, startTime, endTime, masterAudioState);

    if (audioClips.length === 0) {
      log.info('No audio clips found in export range');
      return null;
    }

    log.info(`Found ${audioClips.length} clips with audio`);
    const audioGraphPlan = renderAudioGraph({
      clips: audioClips,
      tracks,
      masterAudioState,
      mode: 'export',
    });

    try {
      // 2. Extract audio from all clips
      onProgress?.({ phase: 'extracting', percent: 0, message: 'Extracting audio...' });
      const extractedBuffers = await this.extractAllAudio(audioClips, tracks, onProgress);

      if (this.cancelled) return null;

      // 3. Render each clip through the same processed graph used by timeline waveform artifacts
      onProgress?.({ phase: 'processing', percent: 0, message: 'Rendering timeline audio graph...' });
      const effectBuffers = await this.renderAllClipAudio(
        audioClips,
        extractedBuffers,
        clipKeyframes,
        audioGraphPlan,
        onProgress
      );

      if (this.cancelled) return null;

      // 4. Mix all tracks
      onProgress?.({ phase: 'mixing', percent: 0, message: 'Mixing tracks...' });
      const trackData = this.prepareTrackData(audioClips, effectBuffers, tracks, startTime, audioGraphPlan);
      this.mixer.updateSettings({
        normalize: false,
        masterVolumeDb: 0,
        masterLimiterEnabled: false,
      });
      const mixedBuffer = await this.mixer.mixTracks(trackData, duration);
      const masteredBuffer = await this.renderMasterBusAudio(mixedBuffer, audioGraphPlan, onProgress);

      if (this.cancelled) return null;

      // 5. Encode to AAC
      onProgress?.({ phase: 'encoding', percent: 0, message: 'Encoding audio...' });
      const result = await this.encodeAudio(masteredBuffer, onProgress);

      // 6. Cleanup
      this.extractor.clearCache();

      onProgress?.({ phase: 'complete', percent: 100, message: 'Audio export complete' });

      log.info(`Export complete: ${result.chunks.length} chunks`);
      return result;

    } catch (error) {
      log.error('Export failed:', error);
      this.extractor.clearCache();
      throw error;
    }
  }

  /**
   * Export raw audio (mixed but not encoded) for use with external encoders like FFmpeg
   * @param startTime - Export start time
   * @param endTime - Export end time
   * @param onProgress - Progress callback
   * @returns Mixed AudioBuffer as raw PCM data
   */
  async exportRawAudio(
    startTime: number,
    endTime: number,
    onProgress?: AudioExportProgressCallback
  ): Promise<AudioBuffer | null> {
    this.cancelled = false;

    const { clips, tracks, clipKeyframes, masterAudioState } = useTimelineStore.getState();
    const duration = endTime - startTime;

    log.info(`Starting raw audio export: ${startTime.toFixed(2)}s - ${endTime.toFixed(2)}s`);

    // 1. Find all clips with audio in the export range
    const audioClips = AudioExportPipeline.getClipsWithAudio(clips, tracks, startTime, endTime, masterAudioState);

    if (audioClips.length === 0) {
      log.info('No audio clips found in export range');
      return null;
    }

    log.info(`Found ${audioClips.length} clips with audio`);
    const audioGraphPlan = renderAudioGraph({
      clips: audioClips,
      tracks,
      masterAudioState,
      mode: 'export',
    });

    try {
      // 2. Extract audio from all clips
      onProgress?.({ phase: 'extracting', percent: 0, message: 'Extracting audio...' });
      const extractedBuffers = await this.extractAllAudio(audioClips, tracks, onProgress);

      if (this.cancelled) return null;

      // 3. Render each clip through the same processed graph used by timeline waveform artifacts
      onProgress?.({ phase: 'processing', percent: 0, message: 'Rendering timeline audio graph...' });
      const effectBuffers = await this.renderAllClipAudio(
        audioClips,
        extractedBuffers,
        clipKeyframes,
        audioGraphPlan,
        onProgress
      );

      if (this.cancelled) return null;

      // 4. Mix all tracks
      onProgress?.({ phase: 'mixing', percent: 0, message: 'Mixing tracks...' });
      const trackData = this.prepareTrackData(audioClips, effectBuffers, tracks, startTime, audioGraphPlan);
      this.mixer.updateSettings({
        normalize: false,
        masterVolumeDb: 0,
        masterLimiterEnabled: false,
      });
      const mixedBuffer = await this.mixer.mixTracks(trackData, duration);
      const masteredBuffer = await this.renderMasterBusAudio(mixedBuffer, audioGraphPlan, onProgress);

      // 5. Cleanup
      this.extractor.clearCache();

      onProgress?.({ phase: 'complete', percent: 100, message: 'Audio mixing complete' });

      log.info(`Raw audio export complete: ${masteredBuffer.duration.toFixed(2)}s, ${masteredBuffer.numberOfChannels}ch`);
      return masteredBuffer;

    } catch (error) {
      log.error('Raw audio export failed:', error);
      this.extractor.clearCache();
      throw error;
    }
  }

  /**
   * Cancel the export
   */
  cancel(): void {
    this.cancelled = true;
    log.info('Export cancelled');
  }

  /**
   * Get clips that have audio in the export range
   */
  static hasAudioInRange(
    clips: TimelineClip[],
    tracks: TimelineTrack[],
    startTime: number,
    endTime: number,
    masterAudioState?: MasterAudioState
  ): boolean {
    return AudioExportPipeline.getClipsWithAudio(clips, tracks, startTime, endTime, masterAudioState).length > 0;
  }

  /**
   * Get clips that have audio in the export range
   */
  static getClipsWithAudio(
    clips: TimelineClip[],
    tracks: TimelineTrack[],
    startTime: number,
    endTime: number,
    masterAudioState?: MasterAudioState
  ): TimelineClip[] {
    const mediaFiles = useMediaStore.getState().files;

    const candidates = clips.filter(clip => {
      // Check if clip is in range
      const track = tracks.find(candidate => candidate.id === clip.trackId);
      const clipEnd = clip.startTime + clip.duration;
      const tailSeconds = getClipExportTailSeconds(clip, track, masterAudioState);
      if (clipEnd + tailSeconds <= startTime || clip.startTime >= endTime) {
        return false;
      }

      // Nested composition with mixdown audio
      if (clip.isComposition && clip.mixdownBuffer && clip.hasMixdownAudio) {
        return true;
      }

      // MIDI clips are rendered to audio by the track instrument (issue #182).
      // They carry only note data (a placeholder File), so check that explicitly
      // before the media-source check below would reject them.
      if (clip.source?.type === 'midi') {
        return (clip.midiData?.notes?.length ?? 0) > 0;
      }

      // Check if clip has audio source
      if (!clip.source?.audioElement && !clip.source?.videoElement && !clip.file) {
        return false;
      }

      // For video clips, we need the linked audio clip
      // For audio clips, we use them directly
      if (clip.source?.type === 'audio') {
        const mediaFileId = clip.mediaFileId || clip.source?.mediaFileId;
        const mediaFile = mediaFileId ? mediaFiles.find(file => file.id === mediaFileId) : null;
        if (mediaFile?.hasAudio === false) {
          log.debug('Skipping audio clip for media marked without audio', {
            clip: clip.name,
            mediaFile: mediaFile.name,
          });
          return false;
        }

        return true;
      }

      // Video clips don't have audio in this architecture
      // (audio is in separate linked clips)
      return false;
    });

    if (candidates.length === 0) {
      return [];
    }

    const plan = renderAudioGraph({ clips: candidates, tracks, mode: 'export' });
    const activeTrackIds = new Set(plan.tracks.filter(track => track.active).map(track => track.trackId));
    const activeClipIds = new Set(
      plan.clips
        .filter(clip => clip.active && activeTrackIds.has(clip.trackId))
        .map(clip => clip.clipId)
    );

    return candidates.filter(clip => activeClipIds.has(clip.id));
  }

  /**
   * Extract audio from all clips
   */
  private async extractAllAudio(
    clips: TimelineClip[],
    tracks: TimelineTrack[],
    onProgress?: AudioExportProgressCallback
  ): Promise<Map<string, AudioBuffer>> {
    const buffers = new Map<string, AudioBuffer>();

    // Preload all GM wavetable samples once, before the clip loop. renderMidiClipToBuffer
    // schedules notes synchronously then renders immediately, so samples must already be
    // in the shared bank or GM clips render silent (the async↔sync gap, #193 Phase 4).
    const gmSounds = new Map<string, { program: number; isDrum: boolean }>();
    for (const clip of clips) {
      if (clip.source?.type !== 'midi') continue;
      const instrument = tracks.find(t => t.id === clip.trackId)?.midiInstrument;
      if (instrument?.kind !== 'gm') continue;
      const isDrum = instrument.isDrum ?? false;
      gmSounds.set(`${isDrum ? 'd' : 'm'}${instrument.program}`, { program: instrument.program, isDrum });
    }
    if (gmSounds.size > 0) {
      await getGmSampleBank().ensureLoaded([...gmSounds.values()]);
    }

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];

      if (this.cancelled) break;

      onProgress?.({
        phase: 'extracting',
        percent: Math.round((i / clips.length) * 100),
        currentClip: clip.name,
        message: `Extracting: ${clip.name}`,
      });

      try {
        let buffer: AudioBuffer;

        // MIDI clips: render the track instrument's synth into a buffer (no file
        // to decode). Flows through the rest of the pipeline like any audio clip.
        if (clip.source?.type === 'midi') {
          const track = tracks.find(t => t.id === clip.trackId);
          const midiBuffer = await renderMidiClipToBuffer(clip, track, this.settings.sampleRate);
          buffers.set(
            clip.id,
            midiBuffer ?? this.extractor.createSilentBuffer(Math.max(clip.duration, 0.001)),
          );
          continue;
        }

        // Prefer audio the app already has decoded (in-memory cache) or a fast
        // PCM-WAV audio proxy on disk, instead of re-decoding the full source.
        // This is the same audio used for playback, so it stays consistent.
        const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
        let reusable: AudioBuffer | null = null;
        if (!clip.isComposition && mediaFileId) {
          reusable = proxyFrameCache.getCachedAudioBuffer(mediaFileId)
            ?? await proxyFrameCache.getAudioBuffer(mediaFileId);
        }

        if (clip.isComposition && clip.mixdownBuffer) {
          // Nested composition with pre-mixed audio buffer
          buffer = clip.mixdownBuffer;
          log.debug(`Using mixdown buffer for nested comp ${clip.name}`);
        } else if (reusable) {
          buffer = reusable;
          log.debug(`Using cached/proxy audio for ${clip.name} (${mediaFileId})`);
        } else if (clip.source?.audioElement) {
          // Extract from audio element
          buffer = await this.extractor.extractFromElement(
            clip.source.audioElement,
            clip.id
          );
        } else if (clip.file) {
          // Last resort: decode the full source file
          buffer = await this.extractor.extractAudio(clip.file, clip.id);
        } else {
          log.warn(`No audio source for clip ${clip.id}`);
          continue;
        }

        buffers.set(clip.id, buffer);
      } catch (error) {
        log.error(`Failed to extract audio from ${clip.name}:`, error);
        // Create silent buffer as fallback
        const fallbackDuration = Math.max(clip.outPoint ?? clip.duration, clip.duration, 0.001);
        buffers.set(clip.id, this.extractor.createSilentBuffer(fallbackDuration));
      }
    }

    return buffers;
  }

  /**
   * Render all clip-local audio edits/effects through the shared offline graph.
   */
  private async renderAllClipAudio(
    clips: TimelineClip[],
    buffers: Map<string, AudioBuffer>,
    clipKeyframes: Map<string, Keyframe[]>,
    audioGraphPlan: AudioGraphRenderPlan,
    onProgress?: AudioExportProgressCallback
  ): Promise<Map<string, AudioBuffer>> {
    const processed = new Map<string, AudioBuffer>();
    const clipPlanById = new Map(audioGraphPlan.clips.map(clip => [clip.clipId, clip]));
    const trackPlanById = new Map(audioGraphPlan.tracks.map(track => [track.trackId, track]));

    // Each clip renders through its own fresh OfflineAudioContext (the effect
    // renderers create a new context per call), so clips are independent and can
    // render concurrently. Bounded concurrency keeps memory in check.
    const RENDER_CONCURRENCY = 4;
    let completed = 0;

    const renderOne = async (clip: TimelineClip, index: number): Promise<void> => {
      const buffer = buffers.get(clip.id);
      if (!buffer || this.cancelled) return;

      const keyframes = clipKeyframes.get(clip.id) || [];
      const clipPlan = clipPlanById.get(clip.id);
      const clipTailSeconds = getPlanTailSeconds(clipPlan?.effectChain);

      const rendered = await this.clipAudioRenderer.render({
        clip,
        sourceBuffer: buffer,
        keyframes,
        effectTailSeconds: clipTailSeconds,
        onProgress: progress => this.emitClipRenderProgress(clip, index, clips.length, progress, onProgress),
      });

      const trackPlan = trackPlanById.get(clip.trackId);
      const trackEffects = audioGraphPlanStepsToEffectInstances(trackPlan?.effectChain);
      const trackInputBuffer = trackEffects.length > 0
        ? appendSilence(rendered.buffer, getPlanTailSeconds(trackPlan?.effectChain))
        : rendered.buffer;
      const trackRenderedBuffer = trackEffects.length > 0
        ? await this.graphEffectRenderer.renderEffectInstances(
          trackInputBuffer,
          trackEffects,
          [],
          trackInputBuffer.duration
        )
        : rendered.buffer;

      processed.set(clip.id, trackRenderedBuffer);
      completed += 1;
      onProgress?.({
        phase: 'processing',
        percent: Math.round((completed / clips.length) * 100),
        currentClip: clip.name,
        message: `Rendering audio: ${clip.name}`,
      });
    };

    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < clips.length && !this.cancelled) {
        const index = cursor++;
        await renderOne(clips[index], index);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(RENDER_CONCURRENCY, clips.length) }, () => worker())
    );

    return processed;
  }

  private async renderMasterBusAudio(
    mixedBuffer: AudioBuffer,
    audioGraphPlan: AudioGraphRenderPlan,
    onProgress?: AudioExportProgressCallback
  ): Promise<AudioBuffer> {
    if (this.cancelled) return mixedBuffer;

    const masterEffects = audioGraphPlanStepsToEffectInstances(audioGraphPlan.master.effectChain);
    let masteredBuffer = mixedBuffer;

    if (masterEffects.length > 0) {
      onProgress?.({ phase: 'effects', percent: 95, message: 'Rendering master audio effects...' });
      masteredBuffer = await this.graphEffectRenderer.renderEffectInstances(
        mixedBuffer,
        masterEffects,
        [],
        mixedBuffer.duration
      );
    }

    this.mixer.processMasterBuffer(masteredBuffer, {
      normalize: false,
      masterVolumeDb: audioGraphPlan.master.volumeDb,
      masterLimiterEnabled: false,
    });

    const targetGainDb = this.applyTargetLoudness(masteredBuffer, audioGraphPlan.master.targetLufs);
    if (targetGainDb !== null) {
      onProgress?.({
        phase: 'effects',
        percent: 97,
        message: `Applying target loudness: ${targetGainDb >= 0 ? '+' : ''}${targetGainDb.toFixed(2)} dB`,
      });
    }

    return this.mixer.processMasterBuffer(masteredBuffer, {
      normalize: this.settings.normalize,
      masterVolumeDb: 0,
      masterLimiterEnabled: audioGraphPlan.master.limiterEnabled,
      masterTruePeakCeilingDb: audioGraphPlan.master.truePeakCeilingDb,
    });
  }

  private applyTargetLoudness(buffer: AudioBuffer, targetLufs: number | undefined): number | null {
    if (typeof targetLufs !== 'number' || !Number.isFinite(targetLufs)) {
      return null;
    }

    const summary = analyzeAudioBufferLoudnessSummary(buffer);
    const integratedLufs = summary.integratedLufs;
    if (typeof integratedLufs !== 'number' || !Number.isFinite(integratedLufs) || integratedLufs <= -90) {
      return null;
    }

    const gainDb = Math.max(-24, Math.min(24, targetLufs - integratedLufs));
    if (Math.abs(gainDb) <= 0.05) {
      return null;
    }

    const gain = dbToLinearGain(gainDb);
    for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
      const data = buffer.getChannelData(channelIndex);
      for (let sampleIndex = 0; sampleIndex < data.length; sampleIndex += 1) {
        data[sampleIndex] *= gain;
      }
    }

    return gainDb;
  }

  private emitClipRenderProgress(
    clip: TimelineClip,
    clipIndex: number,
    totalClips: number,
    progress: ClipAudioRenderProgress,
    onProgress?: AudioExportProgressCallback,
  ): void {
    const phase: AudioExportProgress['phase'] = progress.phase === 'effects' ? 'effects' : 'processing';
    onProgress?.({
      phase,
      percent: Math.round(((clipIndex + progress.percent / 100) / Math.max(1, totalClips)) * 100),
      currentClip: clip.name,
      message: progress.message ?? `Rendering audio: ${clip.name}`,
    });
  }

  /**
   * Prepare track data for mixer
   */
  private prepareTrackData(
    clips: TimelineClip[],
    buffers: Map<string, AudioBuffer>,
    tracks: TimelineTrack[],
    exportStartTime: number,
    audioGraphPlan?: AudioGraphRenderPlan
  ): AudioTrackData[] {
    const trackData: AudioTrackData[] = [];
    const plan = audioGraphPlan ?? renderAudioGraph({ clips, tracks, mode: 'export' });
    const clipPlanById = new Map(plan.clips.map(clip => [clip.clipId, clip]));
    const trackPlanById = new Map(plan.tracks.map(track => [track.trackId, track]));

    for (const clip of clips) {
      const buffer = buffers.get(clip.id);
      if (!buffer) continue;

      const track = tracks.find(t => t.id === clip.trackId);
      if (!track) continue;

      const clipPlan = clipPlanById.get(clip.id);
      const trackPlan = trackPlanById.get(clip.trackId);
      if (!clipPlan?.active || !trackPlan?.active) continue;

      const baseTrackData: AudioTrackData = {
        clipId: clip.id,
        buffer,
        startTime: clip.startTime - exportStartTime, // Adjust for export range
        sourceOffsetTime: Math.max(0, exportStartTime - clip.startTime),
        trackId: clip.trackId,
        trackMuted: trackPlan.muted || !trackPlan.active,
        trackSolo: trackPlan.solo,
        mixRole: 'main',
        trackVolumeDb: trackPlan.volumeDb,
        trackPan: trackPlan.pan,
      };

      trackData.push(baseTrackData);

      for (const send of trackPlan.sends) {
        if (send.enabled === false) continue;

        trackData.push({
          ...baseTrackData,
          clipId: `${clip.id}:send:${send.id}`,
          mixRole: 'send',
          sendId: send.id,
          sendTargetBusId: send.targetBusId,
          sendPreFader: send.preFader,
          trackVolumeDb: send.gainDb + (send.preFader ? 0 : trackPlan.volumeDb),
        });
      }
    }

    return trackData;
  }

  /**
   * Encode mixed audio to AAC
   */
  private async encodeAudio(
    buffer: AudioBuffer,
    onProgress?: AudioExportProgressCallback
  ): Promise<EncodedAudioResult> {
    // Ensure stereo
    let stereoBuffer = buffer;
    if (buffer.numberOfChannels === 1) {
      stereoBuffer = this.extractor.convertToStereo(buffer);
    }

    // Resample if needed
    if (stereoBuffer.sampleRate !== this.settings.sampleRate) {
      stereoBuffer = await this.extractor.resampleBuffer(
        stereoBuffer,
        this.settings.sampleRate
      );
    }

    // Create encoder
    this.encoder = new AudioEncoderWrapper({
      sampleRate: this.settings.sampleRate,
      numberOfChannels: 2,
      bitrate: this.settings.bitrate,
    });

    const supported = await this.encoder.init();
    if (!supported) {
      throw new Error('AAC audio encoding is not supported in this browser');
    }

    // Encode with progress
    await this.encoder.encode(stereoBuffer, (progress) => {
      onProgress?.({
        phase: 'encoding',
        percent: progress.percent,
        message: `Encoding: ${progress.percent}%`,
      });
    });

    return await this.encoder.finalize();
  }

  /**
   * Get current settings
   */
  getSettings(): AudioExportSettings {
    return { ...this.settings };
  }

  /**
   * Update settings
   */
  updateSettings(settings: Partial<AudioExportSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.mixer.updateSettings({
      sampleRate: this.settings.sampleRate,
      normalize: this.settings.normalize,
    });
  }

  /**
   * Check if audio export is supported
   */
  static async isSupported(): Promise<boolean> {
    return await AudioEncoderWrapper.isSupported();
  }
}

// Default instance
export const audioExportPipeline = new AudioExportPipeline();

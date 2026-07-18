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
import type { AudioGraphRenderPlan } from './AudioGraphTypes';
import { AudioEffectRenderer } from './AudioEffectRenderer';
import { ClipAudioRenderService } from '../../services/audio/ClipAudioRenderService';
import {
  planMidiClipNotes,
  planMidiTrackClips,
  renderMidiClipToBuffer,
  type MidiClipRenderPlan,
} from './MidiClipRenderer';
import { getGmSampleBank } from './GmSampleBank';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { proxyFrameCache } from '../../services/proxyFrameCache';
import type { MasterAudioState, TimelineClip, TimelineTrack, Keyframe } from '../../types';
import {
  canRetainExportAudioBuffer,
  reportExportAudioBuffer,
  type ExportAudioBufferStage,
} from '../../services/timeline/exportRuntimeReporting';
import type { TimelineRuntimeAdmissionDecision } from '../../services/timeline/runtimeCoordinatorTypes';
import {
  requestCompositionAudioMixdown,
} from '../../services/timeline/compositionAudioMixdownCache';
import { applyCompositionAudioMixdownToTimelineClip } from '../../services/timeline/compositionAudioMixdownTimelineState';
import { createBuffer as createAudioBufferLike } from './audioBufferFactory';
import { encodeExportAudio } from './exportPipeline/encodeHandOff';
import { renderExportClipAudioEffects } from './exportPipeline/effectStage';
import { renderExportMasterBusAudio } from './exportPipeline/masterBusStage';
import { getClipExportTailSeconds } from './exportPipeline/rangePlanning';
import { prepareExportTrackData } from './exportPipeline/trackDataPlanning';

const log = Logger.create('AudioExportPipeline');

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

export interface AudioExportRuntimeOptions {
  exportRunId?: string;
}

export class AudioExportPipeline {
  private extractor: AudioExtractor;
  private encoder: AudioEncoderWrapper | null = null;
  private mixer: AudioMixer;
  private clipAudioRenderer: ClipAudioRenderService;
  private graphEffectRenderer: AudioEffectRenderer;
  private settings: AudioExportSettings;
  private cancelled = false;
  private exportRunId?: string;

  constructor(settings?: Partial<AudioExportSettings>, runtimeOptions?: AudioExportRuntimeOptions) {
    this.settings = {
      sampleRate: settings?.sampleRate ?? 48000,
      bitrate: settings?.bitrate ?? 256000,
      normalize: settings?.normalize ?? false,
    };
    this.exportRunId = runtimeOptions?.exportRunId;

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
      const plannedMixBuffer = createAudioBufferLike(
        2,
        Math.ceil(duration * this.settings.sampleRate),
        this.settings.sampleRate
      );
      this.assertAudioBufferAdmission('mix-buffer', plannedMixBuffer);
      this.mixer.updateSettings({
        normalize: false,
        masterVolumeDb: 0,
        masterLimiterEnabled: false,
      });
      const mixedBuffer = await this.mixer.mixTracks(trackData, duration);
      if (this.cancelled) return null;
      this.reportAudioBuffer('mix-buffer', mixedBuffer);
      this.assertAudioBufferAdmission('master-buffer', mixedBuffer);
      const masteredBuffer = await this.renderMasterBusAudio(mixedBuffer, audioGraphPlan, onProgress);

      if (this.cancelled) return null;
      this.reportAudioBuffer('master-buffer', masteredBuffer);

      // 5. Encode to AAC
      onProgress?.({ phase: 'encoding', percent: 0, message: 'Encoding audio...' });
      const result = await this.encodeAudio(masteredBuffer, onProgress);
      if (this.cancelled || !result) return null;

      onProgress?.({ phase: 'complete', percent: 100, message: 'Audio export complete' });

      log.info(`Export complete: ${result.chunks.length} chunks`);
      return result;

    } catch (error) {
      log.error('Export failed:', error);
      throw error;
    } finally {
      this.extractor.clearCache();
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
      const plannedMixBuffer = createAudioBufferLike(
        2,
        Math.ceil(duration * this.settings.sampleRate),
        this.settings.sampleRate
      );
      this.assertAudioBufferAdmission('mix-buffer', plannedMixBuffer);
      this.mixer.updateSettings({
        normalize: false,
        masterVolumeDb: 0,
        masterLimiterEnabled: false,
      });
      const mixedBuffer = await this.mixer.mixTracks(trackData, duration);
      if (this.cancelled) return null;
      this.reportAudioBuffer('mix-buffer', mixedBuffer);
      this.assertAudioBufferAdmission('master-buffer', mixedBuffer);
      const masteredBuffer = await this.renderMasterBusAudio(mixedBuffer, audioGraphPlan, onProgress);

      if (this.cancelled) return null;
      this.reportAudioBuffer('master-buffer', masteredBuffer);

      onProgress?.({ phase: 'complete', percent: 100, message: 'Audio mixing complete' });

      log.info(`Raw audio export complete: ${masteredBuffer.duration.toFixed(2)}s, ${masteredBuffer.numberOfChannels}ch`);
      return masteredBuffer;

    } catch (error) {
      log.error('Raw audio export failed:', error);
      throw error;
    } finally {
      this.extractor.clearCache();
    }
  }

  /**
   * Cancel the export
   */
  cancel(): void {
    this.cancelled = true;
    this.encoder?.cancel();
    log.info('Export cancelled');
  }

  private canReportRuntime(): boolean {
    return Boolean(this.exportRunId) && !this.cancelled;
  }

  private getAudioAdmissionDecision(
    stage: ExportAudioBufferStage,
    buffer: AudioBuffer,
    clip?: TimelineClip
  ): TimelineRuntimeAdmissionDecision | null {
    if (!this.exportRunId || !this.canReportRuntime()) {
      return null;
    }

    return canRetainExportAudioBuffer({
      runId: this.exportRunId,
      stage,
      buffer,
      clipId: clip?.id,
      mediaFileId: clip ? this.getClipMediaFileId(clip) : undefined,
      trackId: clip?.trackId,
    });
  }

  private createAudioAdmissionError(
    stage: ExportAudioBufferStage,
    decision: TimelineRuntimeAdmissionDecision,
    clip?: TimelineClip
  ): Error {
    const rejectedUnits = decision.rejectedUnits
      .map((entry) => `${entry.unit}:${entry.used}/${entry.limit ?? 'unbounded'}`)
      .join(', ');
    const error = new Error(
      `Export audio ${stage} denied by runtime admission${clip ? ` for ${clip.name}` : ''}: ${
        decision.reason ?? 'unknown'
      }${rejectedUnits ? ` (${rejectedUnits})` : ''}`
    );
    error.name = 'ExportAudioAdmissionError';
    return error;
  }

  private assertAudioBufferAdmission(
    stage: ExportAudioBufferStage,
    buffer: AudioBuffer,
    clip?: TimelineClip
  ): void {
    const decision = this.getAudioAdmissionDecision(stage, buffer, clip);
    if (decision && !decision.admitted) {
      throw this.createAudioAdmissionError(stage, decision, clip);
    }
  }

  private reportAudioBuffer(
    stage: ExportAudioBufferStage,
    buffer: AudioBuffer,
    clip?: TimelineClip
  ): boolean {
    if (!this.exportRunId || !this.canReportRuntime()) {
      return false;
    }

    const admission = this.getAudioAdmissionDecision(stage, buffer, clip);
    if (admission && !admission.admitted) {
      log.warn('Export audio buffer report skipped by runtime admission', {
        stage,
        clipId: clip?.id,
        resourceId: admission.resourceId,
        reason: admission.reason,
        rejectedUnits: admission.rejectedUnits.map((entry) => entry.unit),
      });
      return false;
    }

    reportExportAudioBuffer({
      runId: this.exportRunId,
      stage,
      buffer,
      clipId: clip?.id,
      mediaFileId: clip ? this.getClipMediaFileId(clip) : undefined,
      trackId: clip?.trackId,
    });
    return true;
  }

  private getClipMediaFileId(clip: TimelineClip): string | undefined {
    return clip.mediaFileId ?? clip.source?.mediaFileId;
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

    // Match the live scheduler's one-synth-per-track voice ceiling. Planning all
    // MIDI clips together prevents overlapping clips from each claiming a full
    // independent cap during export.
    const midiPlans = new Map<string, MidiClipRenderPlan>();
    for (const track of tracks) {
      if (track.type !== 'midi') continue;
      const trackClips = clips.filter(
        (clip) => clip.trackId === track.id && clip.source?.type === 'midi',
      );
      for (const [clipId, plan] of planMidiTrackClips(trackClips, track)) {
        midiPlans.set(clipId, plan);
      }
    }
    for (const clip of clips) {
      if (clip.source?.type !== 'midi' || midiPlans.has(clip.id)) continue;
      midiPlans.set(clip.id, planMidiClipNotes(clip, undefined));
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
          const midiBuffer = await renderMidiClipToBuffer(
            clip,
            track,
            this.settings.sampleRate,
            midiPlans.get(clip.id),
          );
          const buffer = midiBuffer ?? this.extractor.createSilentBuffer(Math.max(clip.duration, 0.001));
          this.assertAudioBufferAdmission('source-buffer', buffer, clip);
          buffers.set(clip.id, buffer);
          this.reportAudioBuffer('source-buffer', buffer, clip);
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

        if (clip.isComposition) {
          const mixdown = await requestCompositionAudioMixdown(clip);
          if (!mixdown?.hasAudio) {
            log.debug(`Skipping nested comp without audio ${clip.name}`);
            continue;
          }
          buffer = mixdown.buffer;
          this.assertAudioBufferAdmission('source-buffer', buffer, clip);
          applyCompositionAudioMixdownToTimelineClip(clip.id, mixdown);
          log.debug(`Using lazy mixdown buffer for nested comp ${clip.name}`);
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

        this.assertAudioBufferAdmission('source-buffer', buffer, clip);
        buffers.set(clip.id, buffer);
        this.reportAudioBuffer('source-buffer', buffer, clip);
      } catch (error) {
        if (error instanceof Error && error.name === 'ExportAudioAdmissionError') {
          throw error;
        }
        log.error(`Failed to extract audio from ${clip.name}:`, error);
        // Create silent buffer as fallback
        const fallbackDuration = Math.max(clip.outPoint ?? clip.duration, clip.duration, 0.001);
        const fallbackBuffer = this.extractor.createSilentBuffer(fallbackDuration);
        this.assertAudioBufferAdmission('source-buffer', fallbackBuffer, clip);
        buffers.set(clip.id, fallbackBuffer);
        this.reportAudioBuffer('source-buffer', fallbackBuffer, clip);
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
    return renderExportClipAudioEffects({
      clips,
      buffers,
      clipKeyframes,
      audioGraphPlan,
      clipAudioRenderer: this.clipAudioRenderer,
      graphEffectRenderer: this.graphEffectRenderer,
      shouldCancel: () => this.cancelled,
      assertAudioBufferAdmission: (stage, buffer, clip) => this.assertAudioBufferAdmission(stage, buffer, clip),
      reportAudioBuffer: (stage, buffer, clip) => this.reportAudioBuffer(stage, buffer, clip),
      onProgress,
    });
  }

  private async renderMasterBusAudio(
    mixedBuffer: AudioBuffer,
    audioGraphPlan: AudioGraphRenderPlan,
    onProgress?: AudioExportProgressCallback
  ): Promise<AudioBuffer> {
    return renderExportMasterBusAudio({
      mixedBuffer,
      audioGraphPlan,
      graphEffectRenderer: this.graphEffectRenderer,
      mixer: this.mixer,
      normalize: this.settings.normalize,
      shouldCancel: () => this.cancelled,
      onProgress,
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
    return prepareExportTrackData(clips, buffers, tracks, exportStartTime, audioGraphPlan);
  }

  /**
   * Encode mixed audio to AAC
   */
  private async encodeAudio(
    buffer: AudioBuffer,
    onProgress?: AudioExportProgressCallback
  ): Promise<EncodedAudioResult | null> {
    return encodeExportAudio({
      buffer,
      settings: this.settings,
      extractor: this.extractor,
      shouldCancel: () => this.cancelled,
      setEncoder: encoder => {
        this.encoder = encoder;
      },
      onProgress,
    });
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

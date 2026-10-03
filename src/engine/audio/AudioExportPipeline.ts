import { AudioExportSourceStage } from './exportPipeline/sourceStage';
import { selectExportAudioClips } from './exportPipeline/clipSelection';
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
import {
  AudioEncoderWrapper,
  DEFAULT_AUDIO_BITRATE,
  type AudioCodec,
  type EncodedAudioResult,
} from './AudioEncoder';
import { AudioMixer, type AudioTrackData } from './AudioMixer';
import { renderAudioGraph } from './AudioGraphRenderer';
import type { AudioGraphRenderPlan } from './AudioGraphTypes';
import { AudioEffectRenderer } from './AudioEffectRenderer';
import { ClipAudioRenderService } from '../../services/audio/ClipAudioRenderService';
import { useTimelineStore } from '../../stores/timeline';
import { proxyFrameCache } from '../../services/proxyFrameCache';
import type { MasterAudioState, TimelineClip, TimelineTrack, Keyframe } from '../../types';
import {
  canRetainExportAudioBuffer,
  releaseExportAudioBuffer,
  reportExportAudioBuffer,
  type ExportAudioBufferStage,
} from '../../services/timeline/exportRuntimeReporting';
import type { TimelineRuntimeAdmissionDecision } from '../../services/timeline/runtimeCoordinatorTypes';
import { createBuffer as createAudioBufferLike } from './audioBufferFactory';
import { encodeExportAudio } from './exportPipeline/encodeHandOff';
import { renderExportClipAudioEffects } from './exportPipeline/effectStage';
import { renderExportMasterBusAudio } from './exportPipeline/masterBusStage';
import { prepareExportTrackData } from './exportPipeline/trackDataPlanning';

const log = Logger.create('AudioExportPipeline');

export interface AudioExportSettings {
  sampleRate: number;       // 44100 or 48000
  bitrate: number;          // Requested bitrate; WebCodecs may select a supported fallback
  normalize: boolean;       // Peak normalize output
  codec?: AudioCodec;       // Pin to the muxer's container-compatible codec when provided
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
  private readonly sourceBufferStarts = new Map<string, number>();
  private readonly preTrimmedClipIds = new Set<string>();
  private readonly suspendedPreviewAudioMediaIds = new Set<string>();

  constructor(settings?: Partial<AudioExportSettings>, runtimeOptions?: AudioExportRuntimeOptions) {
    this.settings = {
      sampleRate: settings?.sampleRate ?? 48000,
      bitrate: settings?.bitrate ?? DEFAULT_AUDIO_BITRATE,
      normalize: settings?.normalize ?? false,
      codec: settings?.codec,
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
    this.resumeSuspendedPreviewAudioBuffers();
    this.preTrimmedClipIds.clear();
    this.sourceBufferStarts.clear();
    this.extractor.clearCache();

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
      const extractedBuffers = await this.extractAllAudio(audioClips, tracks, onProgress, endTime, clipKeyframes);

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
      this.releaseRenderedSourceAudioBuffers(audioClips, extractedBuffers, effectBuffers);

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
      this.releaseProcessedAudioBuffers(audioClips, effectBuffers);
      trackData.length = 0;
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
      this.resumeSuspendedPreviewAudioBuffers();
      this.preTrimmedClipIds.clear();
      this.sourceBufferStarts.clear();
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
    this.resumeSuspendedPreviewAudioBuffers();
    this.preTrimmedClipIds.clear();
    this.sourceBufferStarts.clear();
    this.extractor.clearCache();

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
      const extractedBuffers = await this.extractAllAudio(audioClips, tracks, onProgress, endTime, clipKeyframes);

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
      this.releaseRenderedSourceAudioBuffers(audioClips, extractedBuffers, effectBuffers);

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
      this.releaseProcessedAudioBuffers(audioClips, effectBuffers);
      trackData.length = 0;
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
      this.resumeSuspendedPreviewAudioBuffers();
      this.preTrimmedClipIds.clear();
      this.sourceBufferStarts.clear();
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

  private releaseAudioBuffer(
    stage: ExportAudioBufferStage,
    buffer: AudioBuffer,
    clip?: TimelineClip
  ): void {
    if (!this.exportRunId) {
      return;
    }

    releaseExportAudioBuffer({
      runId: this.exportRunId,
      stage,
      buffer,
      clipId: clip?.id,
      mediaFileId: clip ? this.getClipMediaFileId(clip) : undefined,
      trackId: clip?.trackId,
    });
  }

  /**
   * Clip rendering turns a long shared source into short timeline-sized
   * buffers. Drop every source that is no longer an output before allocating
   * the mix buffer; otherwise a 70-minute stereo source can keep ~1.5 GB alive
   * for the rest of a three-minute export.
   */
  private releaseRenderedSourceAudioBuffers(
    clips: TimelineClip[],
    sourceBuffers: Map<string, AudioBuffer>,
    processedBuffers: Map<string, AudioBuffer>
  ): void {
    const processedValues = new Set(processedBuffers.values());
    const visited = new Set<AudioBuffer>();

    for (const clip of clips) {
      const sourceBuffer = sourceBuffers.get(clip.id);
      if (!sourceBuffer || visited.has(sourceBuffer)) {
        continue;
      }
      visited.add(sourceBuffer);

      // A whole-source clip can legitimately reuse its input as its processed
      // output. Keep that allocation until mixing has consumed it.
      if (processedValues.has(sourceBuffer)) {
        continue;
      }

      this.releaseAudioBuffer('source-buffer', sourceBuffer, clip);
      this.extractor.releaseCachedBuffer?.(sourceBuffer);
      for (const candidate of clips) {
        if (sourceBuffers.get(candidate.id) !== sourceBuffer) {
          continue;
        }
        const mediaFileId = this.getClipMediaFileId(candidate);
        if (mediaFileId) {
          proxyFrameCache.releaseCachedAudioBuffer(mediaFileId, sourceBuffer);
        }
      }
    }

    sourceBuffers.clear();
  }

  private releaseProcessedAudioBuffers(
    clips: TimelineClip[],
    processedBuffers: Map<string, AudioBuffer>
  ): void {
    for (const clip of clips) {
      const buffer = processedBuffers.get(clip.id);
      if (buffer) {
        this.releaseAudioBuffer('processed-buffer', buffer, clip);
      }
    }
    processedBuffers.clear();
  }

  private getClipMediaFileId(clip: TimelineClip): string | undefined {
    return clip.mediaFileId ?? clip.source?.mediaFileId;
  }

  private resumeSuspendedPreviewAudioBuffers(): void {
    for (const mediaFileId of this.suspendedPreviewAudioMediaIds) {
      proxyFrameCache.resumeDecodedAudioBuffer(mediaFileId);
    }
    this.suspendedPreviewAudioMediaIds.clear();
  }

  private suspendPreviewAudioBufferForExport(
    mediaFileId: string,
    suspendedMediaIds: Set<string>,
  ): void {
    if (suspendedMediaIds.has(mediaFileId)) {
      return;
    }

    proxyFrameCache.suspendDecodedAudioBuffer(mediaFileId);
    suspendedMediaIds.add(mediaFileId);
    this.suspendedPreviewAudioMediaIds.add(mediaFileId);
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
  static getClipsWithAudio(clips: TimelineClip[], tracks: TimelineTrack[], startTime: number,
    endTime: number, masterAudioState?: MasterAudioState): TimelineClip[] {
    return selectExportAudioClips(clips, tracks, startTime, endTime, masterAudioState);
  }

  /**
   * Extract audio from all clips
   */
  private async extractAllAudio(
    clips: TimelineClip[], tracks: TimelineTrack[], onProgress?: AudioExportProgressCallback,
    exportEndTime?: number, clipKeyframes = useTimelineStore.getState().clipKeyframes,
  ): Promise<Map<string, AudioBuffer>> {
    return new AudioExportSourceStage({ extractor: this.extractor, sampleRate: this.settings.sampleRate,
      shouldCancel: () => this.cancelled, preTrimmedClipIds: this.preTrimmedClipIds, clipKeyframes,
      sourceBufferStarts: this.sourceBufferStarts,
      retainSourceBuffer: (buffer, clip) => {
        this.assertAudioBufferAdmission('source-buffer', buffer, clip);
        this.reportAudioBuffer('source-buffer', buffer, clip);
      },
      suspendPreviewAudioBuffer: (id, suspended) => this.suspendPreviewAudioBufferForExport(id, suspended),
    }).extract(clips, tracks, onProgress, exportEndTime);
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
      preTrimmedClipIds: this.preTrimmedClipIds,
      sourceBufferStarts: this.sourceBufferStarts,
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

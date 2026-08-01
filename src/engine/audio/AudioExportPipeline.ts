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
import { proxyFrameCache } from '../../services/proxyFrameCache';
import type { MasterAudioState, TimelineClip, TimelineTrack, Keyframe } from '../../types';
import {
  canRetainExportAudioBuffer,
  releaseExportAudioBuffer,
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
import {
  createFileAudioByteRangeSource,
  createUrlAudioByteRangeSource,
  readWavPcmAudioRange,
} from './exportPipeline/WavPcmRangeReader';
import { MediaAudioRangeReader } from './exportPipeline/MediaAudioRangeReader';
import { projectFileService } from '../../services/projectFileService';
import { getAudioProxyStorageKey } from '../../services/audio/AudioProxyService';
import { readAudioExportMediaFiles } from '../../services/export/audioExportMediaStoreAdapter';

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
  private readonly preTrimmedClipIds = new Set<string>();
  private readonly suspendedPreviewAudioMediaIds = new Set<string>();

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
    this.resumeSuspendedPreviewAudioBuffers();
    this.preTrimmedClipIds.clear();
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
      const extractedBuffers = await this.extractAllAudio(audioClips, tracks, onProgress, endTime);

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
      const extractedBuffers = await this.extractAllAudio(audioClips, tracks, onProgress, endTime);

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
  static getClipsWithAudio(
    clips: TimelineClip[],
    tracks: TimelineTrack[],
    startTime: number,
    endTime: number,
    masterAudioState?: MasterAudioState
  ): TimelineClip[] {
    const mediaFiles = readAudioExportMediaFiles();

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
    onProgress?: AudioExportProgressCallback,
    exportEndTime?: number,
  ): Promise<Map<string, AudioBuffer>> {
    const buffers = new Map<string, AudioBuffer>();
    const sourceBuffersByMediaId = new Map<string, AudioBuffer>();
    const sourceBuffersByFile = new WeakMap<File, AudioBuffer>();
    const sourceBuffersByElement = new WeakMap<HTMLMediaElement, AudioBuffer>();
    const retainedSourceBuffers = new WeakSet<AudioBuffer>();
    const releasedFullSourceMediaIds = new Set<string>();
    const mediaRangeReadersByFile = new Map<File, MediaAudioRangeReader>();

    const getSharedSourceBuffer = (
      clip: TimelineClip,
      mediaFileId: string | undefined,
    ): AudioBuffer | undefined => {
      if (clip.isComposition || clip.source?.type === 'midi') return undefined;
      if (mediaFileId) {
        const buffer = sourceBuffersByMediaId.get(mediaFileId);
        if (buffer) return buffer;
      }
      if (clip.file) {
        const buffer = sourceBuffersByFile.get(clip.file);
        if (buffer) return buffer;
      }
      const mediaElement = clip.source?.audioElement ?? clip.source?.videoElement;
      return mediaElement
        ? sourceBuffersByElement.get(mediaElement)
        : undefined;
    };

    const rememberSharedSourceBuffer = (
      clip: TimelineClip,
      mediaFileId: string | undefined,
      buffer: AudioBuffer,
    ): void => {
      if (clip.isComposition || clip.source?.type === 'midi') return;
      if (mediaFileId) {
        sourceBuffersByMediaId.set(mediaFileId, buffer);
      }
      if (clip.file) {
        sourceBuffersByFile.set(clip.file, buffer);
      }
      const mediaElement = clip.source?.audioElement ?? clip.source?.videoElement;
      if (mediaElement) {
        sourceBuffersByElement.set(mediaElement, buffer);
      }
    };

    const retainSourceBuffer = (
      clip: TimelineClip,
      buffer: AudioBuffer,
    ): void => {
      if (retainedSourceBuffers.has(buffer)) return;
      this.assertAudioBufferAdmission('source-buffer', buffer, clip);
      this.reportAudioBuffer('source-buffer', buffer, clip);
      retainedSourceBuffers.add(buffer);
    };

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

    try {
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
            buffers.set(clip.id, buffer);
            retainSourceBuffer(clip, buffer);
            continue;
          }

          // Read only this clip's byte range from the PCM-WAV proxy. A 70-minute
          // stereo source is ~1.5 GB after Float32 decoding; retaining that whole
          // allocation while video frames are decoded can crash Chrome even when
          // the exported sequence itself is only a few minutes long.
          const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
          const rangedProxyBuffer = !clip.isComposition && mediaFileId
            ? await this.tryReadRangedProxyAudio(
              clip,
              mediaFileId,
              releasedFullSourceMediaIds,
            )
            : null;
          if (rangedProxyBuffer) {
            buffer = rangedProxyBuffer;
            buffers.set(clip.id, buffer);
            this.preTrimmedClipIds.add(clip.id);
            retainSourceBuffer(clip, buffer);
            log.debug(`Using ranged PCM proxy audio for ${clip.name} (${mediaFileId})`);
            continue;
          }

          const mediaFile = mediaFileId
            ? readAudioExportMediaFiles().find(file => file.id === mediaFileId)
            : undefined;
          const sourceFile = mediaFile?.file ?? clip.file;
          const sourceDuration = mediaFile?.duration ?? clip.source?.naturalDuration ?? 0;
          if (
            !clip.isComposition
            && sourceFile
            && sourceFile.size > 0
            && sourceDuration >= 15 * 60
          ) {
            if (mediaFileId) {
              this.suspendPreviewAudioBufferForExport(
                mediaFileId,
                releasedFullSourceMediaIds,
              );
            }

            let reader = mediaRangeReadersByFile.get(sourceFile);
            if (!reader) {
              reader = new MediaAudioRangeReader(sourceFile);
              mediaRangeReadersByFile.set(sourceFile, reader);
            }

            const rangeStart = Math.max(0, clip.inPoint ?? 0);
            const rangeEnd = Number.isFinite(clip.outPoint)
              ? Math.max(rangeStart + 0.001, clip.outPoint as number)
              : rangeStart + Math.max(clip.duration * Math.abs(clip.speed ?? 1), 0.001);
            try {
              buffer = await reader.read(rangeStart, rangeEnd);
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              throw this.createAudioRangeRequiredError(mediaFile?.name ?? clip.name, reason);
            }

            buffers.set(clip.id, buffer);
            this.preTrimmedClipIds.add(clip.id);
            retainSourceBuffer(clip, buffer);
            log.debug(`Using direct ranged media audio for ${clip.name} (${mediaFileId ?? 'file'})`);
            continue;
          }

          // Fall back to an already-decoded source or full-source extraction for
          // short media and formats that do not yet have a bounded decoder.
          const sharedSourceBuffer = getSharedSourceBuffer(clip, mediaFileId);
          let reusable: AudioBuffer | null = sharedSourceBuffer ?? null;
          if (!reusable && !clip.isComposition && mediaFileId) {
            reusable = proxyFrameCache.getCachedAudioBuffer(mediaFileId)
              ?? await proxyFrameCache.getAudioBuffer(mediaFileId);
          }

          if (sharedSourceBuffer) {
            buffer = sharedSourceBuffer;
            log.debug(`Reusing export source audio for ${clip.name} (${mediaFileId ?? 'shared source'})`);
          } else if (clip.isComposition) {
            const mixdown = await requestCompositionAudioMixdown(clip);
            if (!mixdown?.hasAudio) {
              log.debug(`Skipping nested comp without audio ${clip.name}`);
              continue;
            }
            buffer = this.trimCompositionMixdownForExport(clip, mixdown.buffer, exportEndTime);
            const usesCompleteMixdown = buffer === mixdown.buffer;
            if (!usesCompleteMixdown) {
              this.preTrimmedClipIds.add(clip.id);
            }
            // Admission must succeed before committing lazily generated mixdown
            // state to the timeline. A bounded export-only buffer must not replace
            // the reusable full-composition mixdown stored on the clip.
            retainSourceBuffer(clip, buffer);
            if (usesCompleteMixdown) {
              applyCompositionAudioMixdownToTimelineClip(clip.id, mixdown);
            }
            log.debug(
              `Using ${usesCompleteMixdown ? 'complete' : 'export-bounded'} lazy mixdown buffer for nested comp ${clip.name}`
            );
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

          rememberSharedSourceBuffer(clip, mediaFileId, buffer);
          buffers.set(clip.id, buffer);
          retainSourceBuffer(clip, buffer);
        } catch (error) {
          if (
            error instanceof Error
            && (
              error.name === 'ExportAudioAdmissionError'
              || error.name === 'ExportAudioRangeRequiredError'
            )
          ) {
            throw error;
          }
          log.error(`Failed to extract audio from ${clip.name}:`, error);
          // Create silent buffer as fallback
          const fallbackDuration = Math.max(clip.outPoint ?? clip.duration, clip.duration, 0.001);
          const fallbackBuffer = this.extractor.createSilentBuffer(fallbackDuration);
          const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
          rememberSharedSourceBuffer(clip, mediaFileId, fallbackBuffer);
          buffers.set(clip.id, fallbackBuffer);
          retainSourceBuffer(clip, fallbackBuffer);
        }
      }
    } finally {
      for (const reader of mediaRangeReadersByFile.values()) {
        reader.dispose();
      }
    }

    return buffers;
  }

  /**
   * Keep a nested composition source anchored at clip.inPoint, but stop it at
   * the end of the requested export range. Keeping the start anchor intact
   * preserves prepareExportTrackData's sourceOffsetTime when an export begins
   * in the middle of a clip while avoiding hundreds of seconds of unused PCM.
   */
  private trimCompositionMixdownForExport(
    clip: TimelineClip,
    buffer: AudioBuffer,
    exportEndTime?: number,
  ): AudioBuffer {
    if (!Number.isFinite(exportEndTime) || clip.reversed) {
      return buffer;
    }

    const speed = Math.abs(clip.speed ?? 1);
    if (!Number.isFinite(speed) || speed <= 0) {
      return buffer;
    }

    const sourceStart = Math.max(0, clip.inPoint ?? 0);
    const activeTimelineDuration = Math.max(
      0,
      Math.min(clip.duration, (exportEndTime as number) - clip.startTime),
    );
    const declaredSourceEnd = Number.isFinite(clip.outPoint)
      ? Math.max(sourceStart, clip.outPoint as number)
      : sourceStart + clip.duration * speed;
    const sourceEnd = Math.min(
      buffer.duration,
      declaredSourceEnd,
      sourceStart + activeTimelineDuration * speed,
    );

    if (sourceStart <= 0.000_001 && sourceEnd >= buffer.duration - 0.000_001) {
      return buffer;
    }

    const startSample = Math.max(0, Math.floor(sourceStart * buffer.sampleRate));
    const endSample = Math.min(
      buffer.length,
      Math.max(startSample + 1, Math.ceil(sourceEnd * buffer.sampleRate)),
    );
    const bounded = createAudioBufferLike(
      buffer.numberOfChannels,
      endSample - startSample,
      buffer.sampleRate,
    );

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      bounded.getChannelData(channel).set(
        buffer.getChannelData(channel).subarray(startSample, endSample),
      );
    }

    return bounded;
  }

  private async tryReadRangedProxyAudio(
    clip: TimelineClip,
    mediaFileId: string,
    releasedFullSourceMediaIds: Set<string>,
  ): Promise<AudioBuffer | null> {
    const mediaFile = readAudioExportMediaFiles().find(file => file.id === mediaFileId);
    if (!mediaFile) return null;

    const proxyReady = mediaFile.audioProxyStatus === 'ready' || mediaFile.hasProxyAudio === true;
    if (!proxyReady) return null;

    const rangeStart = Math.max(0, clip.inPoint ?? 0);
    const rangeEnd = Number.isFinite(clip.outPoint)
      ? Math.max(rangeStart + 0.001, clip.outPoint as number)
      : rangeStart + Math.max(clip.duration * Math.abs(clip.speed ?? 1), 0.001);

    // Drop any preview-time full decode before allocating export resources.
    this.suspendPreviewAudioBufferForExport(mediaFileId, releasedFullSourceMediaIds);

    let source = mediaFile.audioProxyUrl
      ? createUrlAudioByteRangeSource(mediaFile.audioProxyUrl)
      : null;

    // FSA returns a disk-backed File whose slice() reads only the requested
    // bytes. The native helper currently downloads the entire proxy, so do not
    // use that path until its transport supports ranged file reads.
    if (
      !source
      && projectFileService.isProjectOpen()
      && projectFileService.activeBackend === 'fsa'
    ) {
      const proxyFile = await projectFileService.getProxyAudio(getAudioProxyStorageKey(mediaFile));
      if (proxyFile) {
        source = createFileAudioByteRangeSource(proxyFile);
      }
    }

    if (!source) {
      if ((mediaFile.duration ?? 0) >= 15 * 60) {
        throw this.createAudioRangeRequiredError(mediaFile.name, 'no range-readable PCM proxy is available');
      }
      return null;
    }

    try {
      return await readWavPcmAudioRange(source, rangeStart, rangeEnd);
    } catch (error) {
      log.warn('Ranged PCM audio proxy read failed', {
        mediaFileId,
        clipId: clip.id,
        rangeStart,
        rangeEnd,
        error,
      });
      if ((mediaFile.duration ?? rangeEnd) >= 15 * 60) {
        const reason = error instanceof Error ? error.message : String(error);
        throw this.createAudioRangeRequiredError(mediaFile.name, reason);
      }
      return null;
    }
  }

  private createAudioRangeRequiredError(mediaName: string, reason: string): Error {
    const error = new Error(
      `Long-source audio export requires a range-readable PCM proxy for ${mediaName}: ${reason}`,
    );
    error.name = 'ExportAudioRangeRequiredError';
    return error;
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

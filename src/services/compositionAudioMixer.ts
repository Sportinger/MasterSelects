/**
 * CompositionAudioMixer - Renders audio from a composition to a mixdown buffer
 *
 * Used when nesting compositions to:
 * 1. Mix down all audio tracks in the nested comp
 * 2. Generate a waveform for display
 * 3. Create a playable audio element for timeline playback
 */

import { Logger } from './logger';
import { useMediaStore } from '../stores/mediaStore';

const log = Logger.create('CompositionAudioMixer');
import { useTimelineStore } from '../stores/timeline';
import { AudioMixer, type AudioTrackData } from '../engine/audio/AudioMixer';
import { audioExtractor } from '../engine/audio/AudioExtractor';
import { ClipAudioRenderService } from './audio/ClipAudioRenderService';
import {
  getTrackAudioMuted,
  getTrackAudioSolo,
  getTrackPan,
  getTrackVolumeDb,
} from './audio/audioGraphRouteSettings';
import type { TimelineClip, TimelineTrack, SerializableClip, Keyframe } from '../types';
import { generateWaveformFromBuffer } from '../stores/timeline/helpers/waveformHelpers';
import { MAX_NESTING_DEPTH } from '../stores/timeline/constants';
import { blobUrlManager } from '../stores/timeline/helpers/blobUrlManager';
import { computeTimelineOccupancy } from './timeline/timelineOccupancy';

export interface CompositionMixdownResult {
  buffer: AudioBuffer;
  waveform: number[];
  duration: number;
  hasAudio: boolean;
}

export interface MixdownProgress {
  phase: 'loading' | 'extracting' | 'mixing' | 'waveform' | 'complete';
  percent: number;
  message?: string;
}

export type MixdownProgressCallback = (progress: MixdownProgress) => void;

class CompositionAudioMixerService {
  private audioContext: AudioContext | null = null;
  private emptyMixdownBuffer: AudioBuffer | null = null;
  private blobUrls: Set<string> = new Set();
  private readonly clipRenderer = new ClipAudioRenderService();

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 48000 });
    }
    return this.audioContext;
  }

  /**
   * Mix down all audio from a composition to a single buffer
   */
  async mixdownComposition(
    compositionId: string,
    onProgress?: MixdownProgressCallback,
    depth: number = 0
  ): Promise<CompositionMixdownResult | null> {
    if (depth >= MAX_NESTING_DEPTH) {
      log.warn('Max nesting depth reached in mixdownComposition', { compositionId, depth });
      return null;
    }
    const { activeCompositionId, compositions, files } = useMediaStore.getState();
    const composition = compositions.find(c => c.id === compositionId);

    if (!composition) {
      log.warn(`Composition ${compositionId} not found`);
      return null;
    }

    onProgress?.({ phase: 'loading', percent: 0, message: 'Loading composition data...' });

    // Get clips and tracks - use timeline store if active, otherwise use serialized data
    const isActiveComp = compositionId === activeCompositionId;
    let clips: (SerializableClip | TimelineClip)[];
    let tracks: TimelineTrack[];
    let activeKeyframes: Map<string, Keyframe[]> | undefined;

    if (isActiveComp) {
      const timelineState = useTimelineStore.getState();
      clips = timelineState.clips;
      tracks = timelineState.tracks;
      activeKeyframes = timelineState.clipKeyframes;
    } else if (composition.timelineData) {
      clips = composition.timelineData.clips || [];
      tracks = composition.timelineData.tracks || [];
    } else {
      log.warn(`Composition ${compositionId} has no timeline data`);
      return null;
    }

    const audioTrackIds = new Set(tracks.filter(t => t.type === 'audio').map(t => t.id));
    const videoTrackIds = new Set(tracks.filter(t => t.type === 'video').map(t => t.id));
    const audioClips = clips.filter(clip => {
      if (audioTrackIds.has(clip.trackId)) return true;
      if (!videoTrackIds.has(clip.trackId) || !clip.isComposition || !clip.compositionId) return false;
      // A nested composition's linked audio half owns its sound. Only legacy
      // or unlinked video halves need an inline mixdown; never render both.
      return !clips.some(candidate =>
        audioTrackIds.has(candidate.trackId) && candidate.isComposition &&
        candidate.compositionId === clip.compositionId &&
        (candidate.id === clip.linkedClipId || candidate.linkedClipId === clip.id)
      );
    });

    if (audioClips.length === 0) {
      log.debug(`No audio clips in composition ${composition.name}`);
      return {
        buffer: this.getEmptyMixdownBuffer(),
        waveform: [],
        duration: composition.duration || 10,
        hasAudio: false,
      };
    }

    log.info(`Processing ${audioClips.length} audio clips from ${composition.name}`);

    onProgress?.({ phase: 'extracting', percent: 10, message: 'Extracting audio...' });

    // Extract and decode audio from each clip
    const trackDataList: AudioTrackData[] = [];
    // occupiedEnd: the mixdown spans actual clip occupancy, not composition tail padding.
    const duration = computeTimelineOccupancy(
      clips as TimelineClip[],
      tracks,
    ).occupied?.endSeconds ?? 0;

    for (let i = 0; i < audioClips.length; i++) {
      const clip = audioClips[i];
      const track = tracks.find(t => t.id === clip.trackId);

      try {
        let extractedBuffer: AudioBuffer | null;
        if (clip.isComposition && clip.compositionId) {
          // Composition placeholders are not media files. This also handles
          // an audio-only subcomp after its video half was removed.
          const nested = await this.mixdownComposition(clip.compositionId, undefined, depth + 1);
          extractedBuffer = nested?.hasAudio ? nested.buffer : null;
        } else {
          const mediaFileId = clip.mediaFileId || ('source' in clip ? clip.source?.mediaFileId : undefined);
          const mediaFile = mediaFileId
            ? files.find(candidate => candidate.id === mediaFileId)
            : files.find(candidate => candidate.name === clip.name);
          const file = ('file' in clip && clip.file?.size ? clip.file : undefined) ?? mediaFile?.file;
          if (!file) {
            log.warn(`No file found for clip ${clip.name}`);
            continue;
          }
          extractedBuffer = await audioExtractor.extractAudio(file, clip.id);
        }
        if (!extractedBuffer) {
          log.warn(`Failed to extract audio from ${clip.name}`);
          continue;
        }

        const renderClip: TimelineClip = 'sourceType' in clip
          ? {
            ...clip,
            file: new File([], clip.name),
            source: { type: clip.sourceType, naturalDuration: clip.naturalDuration },
          }
          : clip;
        const keyframes = activeKeyframes?.get(clip.id) ?? ('keyframes' in clip ? clip.keyframes : undefined) ?? [];
        const { buffer: processedBuffer } = await this.clipRenderer.render({
          clip: renderClip,
          sourceBuffer: extractedBuffer,
          keyframes,
        });

        trackDataList.push({
          clipId: clip.id,
          buffer: processedBuffer,
          startTime: clip.startTime,
          trackId: clip.trackId,
          trackMuted: track ? getTrackAudioMuted(track) : false,
          trackSolo: track ? getTrackAudioSolo(track) : false,
          trackVolumeDb: track ? getTrackVolumeDb(track) : 0,
          trackPan: track ? getTrackPan(track) : 0,
          clipVolume: clip.transform?.opacity ?? 1, // Use opacity as volume proxy
        });
      } catch (e) {
        log.error(`Error processing ${clip.name}`, e);
      }

      onProgress?.({
        phase: 'extracting',
        percent: 10 + Math.round((i / audioClips.length) * 50),
        message: `Extracting ${clip.name}...`,
      });
    }

    if (trackDataList.length === 0) {
      log.info(`No audio could be extracted from composition ${composition.name}`);
      return {
        buffer: this.getEmptyMixdownBuffer(),
        waveform: [],
        duration,
        hasAudio: false,
      };
    }

    onProgress?.({ phase: 'mixing', percent: 60, message: 'Mixing audio tracks...' });

    // Mix all tracks together
    const mixer = new AudioMixer({
      sampleRate: 48000,
      numberOfChannels: 2,
      normalize: true,
    });

    const mixedBuffer = await mixer.mixTracks(trackDataList, duration);

    onProgress?.({ phase: 'waveform', percent: 90, message: 'Generating waveform...' });

    // Generate waveform from mixed buffer
    const waveform = generateWaveformFromBuffer(mixedBuffer, 50);

    onProgress?.({ phase: 'complete', percent: 100, message: 'Complete' });

    log.info(`Mixdown complete: ${duration.toFixed(2)}s, ${waveform.length} waveform samples`);

    return {
      buffer: mixedBuffer,
      waveform,
      duration,
      hasAudio: true,
    };
  }

  /**
   * Create an audio element from an AudioBuffer for playback
   */
  createAudioElement(buffer: AudioBuffer, options: { ownerClipId?: string } = {}): HTMLAudioElement {
    // Convert AudioBuffer to WAV blob
    const wavBlob = this.audioBufferToWav(buffer);
    const url = options.ownerClipId
      ? blobUrlManager.create(options.ownerClipId, wavBlob, 'audio')
      : URL.createObjectURL(wavBlob);
    if (!options.ownerClipId) {
      this.blobUrls.add(url);
    }

    const audio = document.createElement('audio');
    audio.src = url;
    audio.preload = 'auto';

    return audio;
  }

  /**
   * Dispose: close AudioContext and revoke all blob URLs
   */
  dispose(): void {
    // Revoke all blob URLs
    for (const url of this.blobUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch { /* ignore */ }
    }
    this.blobUrls.clear();

    // Close AudioContext
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    this.audioContext = null;
    this.emptyMixdownBuffer = null;
    log.info('CompositionAudioMixer disposed');
  }

  /**
   * No-audio results retain their duration as metadata, not millions of silent samples.
   * Callers gate playback on hasAudio; a shared one-frame buffer preserves the result shape.
   */
  private getEmptyMixdownBuffer(): AudioBuffer {
    this.emptyMixdownBuffer ??= this.getAudioContext().createBuffer(2, 1, 48000);
    return this.emptyMixdownBuffer;
  }

  /**
   * Convert AudioBuffer to WAV Blob
   */
  private audioBufferToWav(buffer: AudioBuffer): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length;
    const bytesPerSample = 2; // 16-bit
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * blockAlign;
    const bufferSize = 44 + dataSize;

    const arrayBuffer = new ArrayBuffer(bufferSize);
    const view = new DataView(arrayBuffer);

    // WAV header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // Interleave and convert to 16-bit
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
      channels.push(buffer.getChannelData(ch));
    }

    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, int16, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }
}

export const compositionAudioMixer = new CompositionAudioMixerService();

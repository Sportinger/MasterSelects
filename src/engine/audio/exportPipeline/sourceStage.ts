import { createBuffer } from '../audioBufferFactory';
import type { TimelineClip, TimelineTrack, Keyframe } from '../../../types';
import type { AudioExportProgressCallback } from '../AudioExportPipeline';
import type { AudioExtractor } from '../AudioExtractor';
import { Logger } from '../../../services/logger';
import { proxyFrameCache } from '../../../services/proxyFrameCache';
import { readAudioExportMediaFiles } from '../../../services/export/audioExportMediaStoreAdapter';
import { requestCompositionAudioMixdown } from '../../../services/timeline/compositionAudioMixdownCache';
import { applyCompositionAudioMixdownToTimelineClip } from '../../../services/timeline/compositionAudioMixdownTimelineState';
import { planMidiClipNotes, planMidiTrackClips, renderMidiClipToBuffer, type MidiClipRenderPlan } from '../MidiClipRenderer';
import { getGmSampleBank } from '../GmSampleBank';
import { projectFileService } from '../../../services/project/ProjectFileService';
import { getAudioProxyStorageKey } from '../../../services/audio/AudioProxyService';
import { createFileAudioByteRangeSource, createUrlAudioByteRangeSource, readWavPcmAudioRange } from './WavPcmRangeReader';
import { MediaAudioRangeReader } from './MediaAudioRangeReader';
import { getExportClipSourceRange, sliceExportSourceBuffer } from './clipSourceRange';

const log = Logger.create('AudioExportSourceStage');
interface SourceStageOptions {
  extractor: AudioExtractor;
  sampleRate: number;
  shouldCancel: () => boolean;
  preTrimmedClipIds: Set<string>;
  sourceBufferStarts?: Map<string, number>;
  clipKeyframes: ReadonlyMap<string, Keyframe[]>;
  retainSourceBuffer: (buffer: AudioBuffer, clip: TimelineClip) => void;
  suspendPreviewAudioBuffer: (mediaFileId: string, suspended: Set<string>) => void;
}

/** Source acquisition and range admission, independent of mixing/encoding. */
export class AudioExportSourceStage {
  private readonly options: SourceStageOptions;
  constructor(options: SourceStageOptions) { this.options = options; }
  async extract(
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
      this.options.retainSourceBuffer(buffer, clip);
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
        const range = getExportClipSourceRange(clip, this.options.clipKeyframes.get(clip.id) ?? [], exportEndTime);
        // Warp interpolation may read the sample at its maximum source endpoint.
        if (clip.timeRemap?.kind === 'warp') range.end += 1 / this.options.sampleRate;

        if (this.options.shouldCancel()) break;

        onProgress?.({
          phase: 'extracting',
          percent: Math.round((i / clips.length) * 100),
          currentClip: clip.name,
          message: `Extracting: ${clip.name}`,
        });

        try {
          let buffer: AudioBuffer;
          if (clip.timeRemap?.kind === 'freeze') {
            buffer = createBuffer(2, 1, this.options.sampleRate);
            buffers.set(clip.id, buffer);
            this.options.preTrimmedClipIds.add(clip.id);
            this.options.sourceBufferStarts?.set(clip.id, range.start);
            retainSourceBuffer(clip, buffer);
            continue;
          }

          // MIDI clips: render the track instrument's synth into a buffer (no file
          // to decode). Flows through the rest of the pipeline like any audio clip.
          if (clip.source?.type === 'midi') {
            const track = tracks.find(t => t.id === clip.trackId);
            const midiBuffer = await renderMidiClipToBuffer(
              clip,
              track,
              this.options.sampleRate,
              midiPlans.get(clip.id),
            );
            const buffer = midiBuffer ?? this.options.extractor.createSilentBuffer(Math.max(clip.duration, 0.001));
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
              releasedFullSourceMediaIds, range,
            )
            : null;
          if (rangedProxyBuffer) {
            buffer = rangedProxyBuffer;
            buffers.set(clip.id, buffer);
            this.options.preTrimmedClipIds.add(clip.id);
            this.options.sourceBufferStarts?.set(clip.id, Math.floor(range.start * buffer.sampleRate) / buffer.sampleRate);
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
              this.options.suspendPreviewAudioBuffer(
                mediaFileId,
                releasedFullSourceMediaIds,
              );
            }

            let reader = mediaRangeReadersByFile.get(sourceFile);
            if (!reader) {
              reader = new MediaAudioRangeReader(sourceFile);
              mediaRangeReadersByFile.set(sourceFile, reader);
            }

            const { start: rangeStart, end: rangeEnd } = range;
            try {
              buffer = await reader.read(rangeStart, rangeEnd);
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              throw this.createAudioRangeRequiredError(mediaFile?.name ?? clip.name, reason);
            }

            buffers.set(clip.id, buffer);
            this.options.preTrimmedClipIds.add(clip.id);
            this.options.sourceBufferStarts?.set(clip.id, Math.floor(range.start * buffer.sampleRate) / buffer.sampleRate);
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
            const acquired = sliceExportSourceBuffer(mixdown.buffer, range);
            buffer = acquired.buffer;
            this.options.sourceBufferStarts?.set(clip.id, acquired.sourceBufferStart);
            const usesCompleteMixdown = buffer === mixdown.buffer;
            this.options.preTrimmedClipIds.add(clip.id);
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
            buffer = await this.options.extractor.extractFromElement(
              clip.source.audioElement,
              clip.id
            );
          } else if (clip.file) {
            // Last resort: decode the full source file
            buffer = await this.options.extractor.extractAudio(clip.file, clip.id);
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
          this.options.sourceBufferStarts?.delete(clip.id);
          this.options.preTrimmedClipIds.delete(clip.id);
          const fallbackDuration = Math.max(clip.outPoint ?? clip.duration, clip.duration, 0.001);
          const fallbackBuffer = this.options.extractor.createSilentBuffer(fallbackDuration);
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

  private async tryReadRangedProxyAudio(
    clip: TimelineClip,
    mediaFileId: string,
    releasedFullSourceMediaIds: Set<string>,
    range: { start: number; end: number },
  ): Promise<AudioBuffer | null> {
    const mediaFile = readAudioExportMediaFiles().find(file => file.id === mediaFileId);
    if (!mediaFile) return null;

    const proxyReady = mediaFile.audioProxyStatus === 'ready' || mediaFile.hasProxyAudio === true;
    if (!proxyReady) return null;

    const { start: rangeStart, end: rangeEnd } = range;

    // Drop any preview-time full decode before allocating export resources.
    this.options.suspendPreviewAudioBuffer(mediaFileId, releasedFullSourceMediaIds);

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

}

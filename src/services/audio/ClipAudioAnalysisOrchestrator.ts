import type { Keyframe, TimelineClip } from '../../types';
import type { SignalMetadata } from '../../signals';
import { audioExtractor } from '../../engine/audio/AudioExtractor';
import { ClipAudioRenderService, type ClipAudioRenderProgress } from './ClipAudioRenderService';
import {
  createFileAudioSourceFingerprint,
  createProcessedClipAudioStateHash,
} from './ProcessedWaveformPyramidService';

export const SOURCE_AUDIO_ANALYSIS_DECODER_ID = 'masterselects.audio-extractor';
export const PROCESSED_AUDIO_ANALYSIS_DECODER_ID = 'masterselects.processed-audio-graph';
export const CLIP_AUDIO_ANALYSIS_DECODER_VERSION = '1.0.0';

export interface PreparedClipAudioAnalysisInput {
  mediaFileId: string;
  sourceFingerprint: string;
  sourceBuffer: AudioBuffer;
  analysisBuffer: AudioBuffer;
  processed: boolean;
  clipAudioStateHash?: string;
  keyframes?: readonly Keyframe[];
  decoderId: string;
  decoderVersion: string;
  metadata: SignalMetadata;
}

export interface PrepareClipAudioAnalysisInputRequest {
  clip: TimelineClip;
  keyframes?: readonly Keyframe[];
  needsProcessed: boolean;
  signal?: AbortSignal;
  onMixdownReady?: (buffer: AudioBuffer) => void;
  onRenderProgress?: (progress: ClipAudioRenderProgress) => void;
}

function compositionMixdownFingerprint(clip: TimelineClip, buffer: AudioBuffer): string {
  return [
    'composition-mixdown',
    clip.compositionId ?? clip.id,
    clip.nestedContentHash ?? 'unknown-content',
    buffer.sampleRate,
    buffer.length,
    Number(buffer.duration.toFixed(6)),
  ].join(':');
}

function createAnalysisMetadata(clip: TimelineClip, processed: boolean): SignalMetadata {
  return {
    sourceClipId: clip.id,
    sourceClipName: clip.name,
    sourceInPoint: clip.inPoint,
    sourceOutPoint: clip.outPoint,
    timelineDuration: clip.duration,
    timelineSpeed: clip.speed ?? 1,
    reversed: clip.reversed === true,
    processed,
  };
}

async function resolveSourceBuffer(
  clip: TimelineClip,
  onMixdownReady?: (buffer: AudioBuffer) => void,
): Promise<{
  sourceBuffer: AudioBuffer | null;
  sourceFingerprint: string;
  mediaFileId?: string;
}> {
  let sourceBuffer: AudioBuffer | null = null;
  let sourceFingerprint = '';
  let mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;

  if (clip.isComposition && clip.compositionId) {
    if (clip.mixdownBuffer) {
      sourceBuffer = clip.mixdownBuffer;
    } else {
      const { compositionAudioMixer } = await import('../compositionAudioMixer');
      const mixdownResult = await compositionAudioMixer.mixdownComposition(clip.compositionId);
      if (mixdownResult?.hasAudio) {
        sourceBuffer = mixdownResult.buffer;
        onMixdownReady?.(mixdownResult.buffer);
      }
    }

    if (sourceBuffer) {
      sourceFingerprint = compositionMixdownFingerprint(clip, sourceBuffer);
      mediaFileId = mediaFileId ?? clip.compositionId;
    }
  } else if (clip.file) {
    mediaFileId = mediaFileId ?? `file:${clip.file.name}:${clip.file.size}:${clip.file.lastModified}`;
    sourceFingerprint = await createFileAudioSourceFingerprint(clip.file);
    sourceBuffer = await audioExtractor.extractAudio(clip.file, mediaFileId);
  }

  return { sourceBuffer, sourceFingerprint, mediaFileId };
}

export async function prepareClipAudioAnalysisInput(
  request: PrepareClipAudioAnalysisInputRequest,
): Promise<PreparedClipAudioAnalysisInput | null> {
  const {
    clip,
    keyframes = [],
    needsProcessed,
    signal,
    onMixdownReady,
    onRenderProgress,
  } = request;
  const source = await resolveSourceBuffer(clip, onMixdownReady);

  if (!source.sourceBuffer) {
    return null;
  }

  if (signal?.aborted) {
    throw new DOMException('Clip audio analysis preparation was cancelled.', 'AbortError');
  }

  const clipAudioStateHash = needsProcessed
    ? createProcessedClipAudioStateHash(clip, { keyframes })
    : undefined;
  let analysisBuffer = source.sourceBuffer;

  if (needsProcessed) {
    const renderer = new ClipAudioRenderService();
    const rendered = await renderer.render({
      clip,
      sourceBuffer: source.sourceBuffer,
      keyframes,
      effectMode: 'analysis-shape',
      onProgress: onRenderProgress,
    });
    analysisBuffer = rendered.buffer;
  }

  return {
    mediaFileId: source.mediaFileId ?? clip.id,
    sourceFingerprint: source.sourceFingerprint,
    sourceBuffer: source.sourceBuffer,
    analysisBuffer,
    processed: needsProcessed,
    clipAudioStateHash,
    keyframes: needsProcessed ? keyframes.map(keyframe => ({ ...keyframe })) : undefined,
    decoderId: needsProcessed
      ? PROCESSED_AUDIO_ANALYSIS_DECODER_ID
      : SOURCE_AUDIO_ANALYSIS_DECODER_ID,
    decoderVersion: CLIP_AUDIO_ANALYSIS_DECODER_VERSION,
    metadata: createAnalysisMetadata(clip, needsProcessed),
  };
}

export function isPreparedClipAudioAnalysisInputStale(
  prepared: Pick<PreparedClipAudioAnalysisInput, 'processed' | 'clipAudioStateHash'> & {
    keyframes?: readonly Keyframe[];
  },
  currentClip: TimelineClip,
): boolean {
  return prepared.processed
    && createProcessedClipAudioStateHash(currentClip, { keyframes: prepared.keyframes }) !== prepared.clipAudioStateHash;
}

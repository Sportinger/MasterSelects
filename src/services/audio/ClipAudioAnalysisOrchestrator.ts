import type { Keyframe, TimelineClip } from '../../types';
import type { SignalMetadata } from '../../signals';
import { audioExtractor } from '../../engine/audio/AudioExtractor';
import { ClipAudioRenderService, type ClipAudioRenderProgress } from './ClipAudioRenderService';
import {
  createFileAudioSourceFingerprint,
  createProcessedClipAudioStateHash,
} from './ProcessedWaveformPyramidService';
import { projectFileService } from '../projectFileService';
import { getStoredProjectFileHandle } from '../project/mediaSourceResolver';
import { Logger } from '../logger';

export const SOURCE_AUDIO_ANALYSIS_DECODER_ID = 'masterselects.audio-extractor';
export const PROCESSED_AUDIO_ANALYSIS_DECODER_ID = 'masterselects.processed-audio-graph';
export const CLIP_AUDIO_ANALYSIS_DECODER_VERSION = '1.0.0';

const log = Logger.create('ClipAudioAnalysisOrchestrator');

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

interface SourceFileCandidate {
  file: File;
  mediaFileId?: string;
  label: string;
}

function isFileLike(value: unknown): value is File {
  return typeof File !== 'undefined' && value instanceof File;
}

function addSourceFileCandidate(
  candidates: SourceFileCandidate[],
  seen: Set<string>,
  file: unknown,
  mediaFileId: string | undefined,
  label: string,
): void {
  if (!isFileLike(file)) return;
  const key = `${file.name}:${file.size}:${file.lastModified}:${label}`;
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push({ file, mediaFileId, label });
}

async function getReadableFileFromHandle(handle: FileSystemFileHandle): Promise<File | null> {
  try {
    let permission: PermissionState = 'granted';
    if (typeof handle.queryPermission === 'function') {
      permission = await handle.queryPermission({ mode: 'read' });
    }
    if (permission !== 'granted' && typeof handle.requestPermission === 'function') {
      permission = await handle.requestPermission({ mode: 'read' });
    }
    if (permission !== 'granted') {
      return null;
    }
    return await handle.getFile();
  } catch (error) {
    log.debug('Unable to read stored project media handle', error);
    return null;
  }
}

async function collectSourceFileCandidates(clip: TimelineClip): Promise<SourceFileCandidate[]> {
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  const candidates: SourceFileCandidate[] = [];
  const seen = new Set<string>();

  addSourceFileCandidate(candidates, seen, clip.file, mediaFileId, 'clip');
  addSourceFileCandidate(candidates, seen, clip.source?.file, mediaFileId, 'clip-source');

  const mediaStoreFile = mediaFileId
    ? await import('../../stores/mediaStore')
      .then(({ useMediaStore }) => useMediaStore.getState().files.find((file) => file.id === mediaFileId))
      .catch(() => undefined)
    : undefined;

  addSourceFileCandidate(candidates, seen, mediaStoreFile?.file, mediaFileId, 'media-library');

  if (mediaStoreFile?.projectPath && projectFileService.isProjectOpen()) {
    try {
      const projectFile = await projectFileService.getFileFromRaw(mediaStoreFile.projectPath);
      addSourceFileCandidate(candidates, seen, projectFile?.file, mediaFileId, 'project-raw');
    } catch (error) {
      log.debug('Unable to read project RAW media file for audio analysis', {
        mediaFileId,
        projectPath: mediaStoreFile.projectPath,
        error,
      });
    }
  }

  const projectHandle = await getStoredProjectFileHandle(mediaFileId);
  if (projectHandle) {
    addSourceFileCandidate(
      candidates,
      seen,
      await getReadableFileFromHandle(projectHandle),
      mediaFileId,
      'project-handle',
    );
  }

  return candidates;
}

async function extractSourceBufferFromCandidate(
  candidate: SourceFileCandidate,
): Promise<{
  sourceBuffer: AudioBuffer;
  sourceFingerprint: string;
  mediaFileId: string;
}> {
  const mediaFileId = candidate.mediaFileId ?? `file:${candidate.file.name}:${candidate.file.size}:${candidate.file.lastModified}`;
  const sourceFingerprint = await createFileAudioSourceFingerprint(candidate.file);
  const sourceBuffer = await audioExtractor.extractAudio(candidate.file, mediaFileId);
  return { sourceBuffer, sourceFingerprint, mediaFileId };
}

async function resolveSourceBuffer(
  clip: TimelineClip,
  onMixdownReady?: (buffer: AudioBuffer) => void,
  signal?: AbortSignal,
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
      const { requestCompositionAudioMixdown } = await import('../timeline/compositionAudioMixdownCache');
      const mixdownResult = await requestCompositionAudioMixdown(clip);
      if (signal?.aborted) {
        throw new DOMException('Clip audio analysis preparation was cancelled.', 'AbortError');
      }
      if (mixdownResult?.hasAudio) {
        sourceBuffer = mixdownResult.buffer;
        onMixdownReady?.(mixdownResult.buffer);
      }
    }

    if (sourceBuffer) {
      sourceFingerprint = compositionMixdownFingerprint(clip, sourceBuffer);
      mediaFileId = mediaFileId ?? clip.compositionId;
    }
  } else {
    const candidates = await collectSourceFileCandidates(clip);
    let lastError: unknown = null;

    for (const candidate of candidates) {
      if (signal?.aborted) {
        throw new DOMException('Clip audio analysis preparation was cancelled.', 'AbortError');
      }

      try {
        const extracted = await extractSourceBufferFromCandidate(candidate);
        sourceBuffer = extracted.sourceBuffer;
        sourceFingerprint = extracted.sourceFingerprint;
        mediaFileId = extracted.mediaFileId;
        break;
      } catch (error) {
        lastError = error;
        log.debug('Audio source candidate could not be read', {
          clipId: clip.id,
          clipName: clip.name,
          candidate: candidate.label,
          error,
        });
      }
    }

    if (!sourceBuffer && lastError) {
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`Source audio file could not be read: ${message}`);
    }
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
  const source = await resolveSourceBuffer(clip, onMixdownReady, signal);

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

import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { projectMediaSourceArtifactsOntoClip } from '../../../services/mediaArtifacts/mediaSourceArtifacts';
import { DEFAULT_TRANSFORM } from '../constants';
import { generateLinkedClipIds } from '../helpers/idGenerator';

export interface AddVideoClipParams {
  trackId: string;
  file: File;
  startTime: number;
  estimatedDuration: number;
  mediaFileId?: string;
  tracks: TimelineTrack[];
  findAvailableAudioTrack: (startTime: number, duration: number) => string | null;
}

export interface AddVideoClipResult {
  videoClip: TimelineClip;
  audioClip: TimelineClip | null;
  audioClipId: string | undefined;
}

export interface LinkedVideoClipPlaceholderParams {
  audioClipId: string;
  audioTrackId: string;
  estimatedDuration: number;
  file: File;
  initialVisualTransform: TimelineClip['transform'];
  mediaFileId?: string;
  sourceTranscript?: TimelineClip['transcript'];
  startTime: number;
  videoClipId: string;
  videoTrackId: string;
}

export function createLinkedVideoClipPlaceholders(
  params: LinkedVideoClipPlaceholderParams,
): { audioClip: TimelineClip; videoClip: TimelineClip } {
  const transcript = params.sourceTranscript
    ? { transcript: params.sourceTranscript, transcriptStatus: 'ready' as const }
    : {};
  const videoClip = projectMediaSourceArtifactsOntoClip({
    id: params.videoClipId,
    trackId: params.videoTrackId,
    name: params.file.name,
    file: params.file,
    startTime: params.startTime,
    duration: params.estimatedDuration,
    inPoint: 0,
    outPoint: params.estimatedDuration,
    source: {
      type: 'video',
      naturalDuration: params.estimatedDuration,
      mediaFileId: params.mediaFileId,
    },
    linkedClipId: params.audioClipId,
    transform: params.initialVisualTransform,
    effects: [],
    isLoading: true,
    ...transcript,
  });
  const audioClip: TimelineClip = {
    id: params.audioClipId,
    trackId: params.audioTrackId,
    name: `${params.file.name} (Audio)`,
    file: params.file,
    startTime: params.startTime,
    duration: params.estimatedDuration,
    inPoint: 0,
    outPoint: params.estimatedDuration,
    source: {
      type: 'audio',
      naturalDuration: params.estimatedDuration,
      mediaFileId: params.mediaFileId,
    },
    linkedClipId: params.videoClipId,
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    isLoading: true,
    ...transcript,
  };
  return { audioClip, videoClip };
}

/**
 * Create placeholder clips for video (and linked audio) immediately.
 * Returns clips ready to be added to state while media loads in background.
 */
export function createVideoClipPlaceholders(params: AddVideoClipParams): AddVideoClipResult {
  const { trackId, file, startTime, estimatedDuration, mediaFileId, findAvailableAudioTrack } = params;
  const { videoId: clipId, audioId } = generateLinkedClipIds();
  const audioTrackId = findAvailableAudioTrack(startTime, estimatedDuration);
  const audioClipId = audioTrackId ? audioId : undefined;
  const videoClip: TimelineClip = {
    id: clipId,
    trackId,
    name: file.name,
    file,
    startTime,
    duration: estimatedDuration,
    inPoint: 0,
    outPoint: estimatedDuration,
    source: { type: 'video', naturalDuration: estimatedDuration, mediaFileId },
    linkedClipId: audioClipId,
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    isLoading: true,
  };

  const audioClip: TimelineClip | null = audioTrackId && audioClipId
    ? {
        id: audioClipId,
        trackId: audioTrackId,
        name: `${file.name} (Audio)`,
        file,
        startTime,
        duration: estimatedDuration,
        inPoint: 0,
        outPoint: estimatedDuration,
        source: { type: 'audio', naturalDuration: estimatedDuration, mediaFileId },
        linkedClipId: clipId,
        transform: { ...DEFAULT_TRANSFORM },
        effects: [],
        isLoading: true,
      }
    : null;

  return { videoClip, audioClip, audioClipId };
}

import { clearAINodeRuntimeCacheForClip } from '../../../services/nodeGraph';
import {
  getMediaSourceArtifactProjection,
  projectMediaSourceArtifactsOntoClip,
} from '../../../services/mediaArtifacts/mediaSourceArtifacts';
import {
  bindRuntimeToClip,
  releaseClipSourceRuntime,
} from '../../../services/mediaRuntime/clipBindings';
import { stopTimelineAudioPlayback } from '../../../services/audio/timelineAudioPlaybackStopper';
import { releaseNativeDecoderForTimelineClip } from '../../../services/timeline/nativeDecoderRuntimeRegistry';
import { releaseLegacyTimelineClipSourceRuntime } from '../../../services/timeline/timelineClipSourceRuntimeCleanup';
import { findTimelineReplacementMediaFile } from '../../../services/timeline/timelineMediaReplacementAccess';
import type { TimelineClip } from '../../../types/timeline';
import { captureSnapshot } from '../../historyStore';
import type { MediaFile } from '../../mediaStore';
import { blobUrlManager } from '../helpers/blobUrlManager';
import { queueMediaSourceArtifactProjection } from './addClipMediaSource';
import type { ClipActionContext } from './clipActionContext';

function positiveDuration(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function releaseReplacedClipRuntime(clip: TimelineClip): void {
  releaseClipSourceRuntime(clip);
  releaseLegacyTimelineClipSourceRuntime(clip, {
    cleanupVideoGpu: true,
    disposeAudioRouting: true,
    revokeObjectUrls: true,
  });
  releaseNativeDecoderForTimelineClip(clip.id);
  clearAINodeRuntimeCacheForClip(clip.id);
  blobUrlManager.revokeAll(clip.id);
}

function replaceVisualSourceArtifacts(clip: TimelineClip, mediaFile: MediaFile): TimelineClip {
  const withoutOldArtifacts: TimelineClip = {
    ...clip,
    analysis: undefined,
    analysisProgress: undefined,
    analysisStatus: undefined,
    faceAnalysisMessage: undefined,
    faceAnalysisProgress: undefined,
    faceAnalysisStatus: undefined,
    sceneDescriptionMessage: undefined,
    sceneDescriptionProgress: undefined,
    sceneDescriptionStatus: undefined,
    sceneDescriptions: undefined,
    transcript: undefined,
    transcriptMessage: undefined,
    transcriptProgress: undefined,
    transcriptStatus: undefined,
  };
  return projectMediaSourceArtifactsOntoClip(
    withoutOldArtifacts,
    getMediaSourceArtifactProjection(mediaFile.id),
  );
}

function createReplacementFile(mediaFile: MediaFile): File {
  return mediaFile.file ?? new File([], mediaFile.name, { type: 'video/*' });
}

function replaceVideoClipSource(clip: TimelineClip, mediaFile: MediaFile): TimelineClip {
  const file = createReplacementFile(mediaFile);
  const naturalDuration = positiveDuration(
    mediaFile.duration,
    positiveDuration(clip.source?.naturalDuration, clip.duration),
  );
  const filePath = mediaFile.absolutePath ?? mediaFile.filePath;
  const source: NonNullable<TimelineClip['source']> = {
    type: 'video',
    naturalDuration,
    mediaFileId: mediaFile.id,
    ...(filePath ? { filePath } : {}),
  };
  const sourceReplaced = replaceVisualSourceArtifacts({
    ...clip,
    file,
    mediaFileId: mediaFile.id,
    source,
    thumbnails: mediaFile.thumbnailUrl ? [mediaFile.thumbnailUrl] : [],
    videoState: undefined,
    isLoading: false,
    needsReload: false,
  }, mediaFile);

  return bindRuntimeToClip(sourceReplaced, {
    file,
    filePath,
    mediaFileId: mediaFile.id,
  });
}

function replaceLinkedAudioSource(clip: TimelineClip, mediaFile: MediaFile): TimelineClip {
  const file = createReplacementFile(mediaFile);
  const naturalDuration = positiveDuration(
    mediaFile.duration,
    positiveDuration(clip.source?.naturalDuration, clip.duration),
  );
  const filePath = mediaFile.absolutePath ?? mediaFile.filePath;
  const {
    bakeHistory: _bakeHistory,
    processedAnalysisRefs: _processedAnalysisRefs,
    sourceAnalysisRefs: _sourceAnalysisRefs,
    sourceAudioRevisionId: _sourceAudioRevisionId,
    stemSeparation: _stemSeparation,
    ...retainedAudioState
  } = clip.audioState ?? {};
  const audioState = {
    ...retainedAudioState,
    ...(mediaFile.audioAnalysisRefs
      ? { sourceAnalysisRefs: structuredClone(mediaFile.audioAnalysisRefs) }
      : {}),
  };
  const source: NonNullable<TimelineClip['source']> = {
    type: 'audio',
    naturalDuration,
    mediaFileId: mediaFile.id,
    ...(filePath ? { filePath } : {}),
  };
  const sourceReplaced: TimelineClip = {
    ...clip,
    file,
    mediaFileId: mediaFile.id,
    source,
    audioState,
    audioAnalysisJob: undefined,
    waveform: mediaFile.waveform,
    waveformChannels: mediaFile.waveformChannels,
    waveformGenerating: false,
    waveformProgress: mediaFile.waveform?.length ? 100 : 0,
    isLoading: false,
    needsReload: false,
  };

  return bindRuntimeToClip(sourceReplaced, {
    file,
    filePath,
    mediaFileId: mediaFile.id,
  });
}

export function replaceClipSourceAction(
  context: ClipActionContext,
  clipId: string,
  mediaFileId: string,
): boolean {
  const state = context.get();
  const clip = state.clips.find(candidate => candidate.id === clipId);
  const mediaFile = findTimelineReplacementMediaFile(mediaFileId);
  const track = clip ? state.tracks.find(candidate => candidate.id === clip.trackId) : undefined;
  if (!clip || track?.locked || clip.source?.type !== 'video' || mediaFile?.type !== 'video') {
    return false;
  }
  if ((clip.source.mediaFileId ?? clip.mediaFileId) === mediaFileId) {
    return true;
  }

  const linkedAudioClip = clip.linkedClipId
    ? state.clips.find(candidate => candidate.id === clip.linkedClipId && candidate.source?.type === 'audio')
    : undefined;
  if (linkedAudioClip) {
    stopTimelineAudioPlayback();
  }
  releaseReplacedClipRuntime(clip);
  if (linkedAudioClip) {
    releaseReplacedClipRuntime(linkedAudioClip);
  }

  const nextVideoClip = replaceVideoClipSource(clip, mediaFile);
  const nextAudioClip = linkedAudioClip ? replaceLinkedAudioSource(linkedAudioClip, mediaFile) : undefined;
  context.set({
    clips: state.clips.map(candidate => {
      if (candidate.id === clip.id) return nextVideoClip;
      if (nextAudioClip && candidate.id === nextAudioClip.id) return nextAudioClip;
      return candidate;
    }),
  });
  state.invalidateCache();
  captureSnapshot('Replace clip source');
  queueMediaSourceArtifactProjection(mediaFileId);
  return true;
}

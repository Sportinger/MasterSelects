import type { ToolResult } from '../../types.ts';
import { formatClipInfo } from '../../utils';
import { resolveClipTranscriptWindow } from '../../../transcription/clipTranscriptResolver';
import { getGaussianSplatGpuRenderer } from '../../../../engine/gaussian/core/GaussianSplatGpuRenderer';
import { resolveSharedSplatSceneKey } from '../../../../engine/scene/runtime/SharedSplatRuntimeUtils';
import { ensureRenderForDiagnostics } from '../renderOnce';
import type { TimelineStore } from './runtime';
import { useMediaStore } from '../../../../stores/mediaStore';
import {
  resolveClipPropertyAuthoringContext,
  resolveTransformPositionUnitMode,
} from '../../../properties/propertyAuthoring';
import {
  getClipMediaFileId,
  getMediaSourceArtifactProjection,
} from '../../../mediaArtifacts/mediaSourceArtifacts';
import {
  isLinkedAudioFollowingVideo,
  resolveLinkedVideoAudioPair,
} from '../../../../stores/timeline/helpers/linkedClipSpeed';

function resolveClipInfoAuthoringContext(clipId: string, timelineStore: TimelineStore) {
  const clip = timelineStore.clips.find((candidate) => candidate.id === clipId);
  if (!clip) return null;
  const media = useMediaStore.getState();
  return resolveClipPropertyAuthoringContext({
    clipId,
    compositions: media.compositions,
    activeCompositionId: media.activeCompositionId,
    liveClipIds: timelineStore.clips.map((candidate) => candidate.id),
    positionUnitMode: resolveTransformPositionUnitMode(clip),
  });
}

export async function handleGetClipDetails(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }
  const track = timelineStore.tracks.find(t => t.id === clip.trackId);
  const linkedSpeedPair = resolveLinkedVideoAudioPair(timelineStore.clips, clip.id);
  const sourceArtifacts = getMediaSourceArtifactProjection(getClipMediaFileId(clip));
  const analysis = clip.analysis ?? sourceArtifacts.analysis;
  const authoringContextResolution = resolveClipInfoAuthoringContext(clip.id, timelineStore);
  if (!authoringContextResolution?.ok) {
    return {
      success: false,
      error: `Cannot resolve property authoring context: ${authoringContextResolution?.reason ?? 'owner-not-found'}`,
    };
  }
  const gaussianRenderer = clip.source?.type === 'gaussian-splat'
    ? getGaussianSplatGpuRenderer()
    : null;
  const gaussianSceneKey = clip.source?.type === 'gaussian-splat'
    ? resolveSharedSplatSceneKey({
        clipId: clip.id,
        runtimeKey: clip.source.gaussianSplatRuntimeKey,
      })
    : null;
  const renderDiagnostics = gaussianRenderer
    ? await ensureRenderForDiagnostics()
    : undefined;
  const gaussianSceneLoaded = gaussianSceneKey
    ? gaussianRenderer?.hasScene(gaussianSceneKey)
    : undefined;
  const gaussianRenderDebug = gaussianSceneKey
    ? gaussianRenderer?.getLastRenderDebug(gaussianSceneKey) ?? undefined
    : undefined;
  const gaussianTargetSummary = args.includeGaussianTargetSummary === true && gaussianRenderer && gaussianSceneKey
    ? await gaussianRenderer.readLastRenderTargetSummary(gaussianSceneKey)
    : undefined;

  return {
    success: true,
    data: {
      ...formatClipInfo(clip, track, authoringContextResolution.context),
      source: clip.source
        ? {
            type: clip.source.type,
            mediaFileId: clip.source.mediaFileId,
            gaussianSplatUrl: clip.source.type === 'gaussian-splat' ? clip.source.gaussianSplatUrl : undefined,
            gaussianSplatRuntimeKey: clip.source.type === 'gaussian-splat' ? clip.source.gaussianSplatRuntimeKey : undefined,
            gaussianSplatSettings: clip.source.type === 'gaussian-splat' ? clip.source.gaussianSplatSettings : undefined,
          }
        : null,
      isLoading: clip.isLoading ?? false,
      hasFile: clip.file instanceof File,
      waveform: {
        generating: clip.waveformGenerating === true,
        progress: clip.waveformProgress ?? null,
        sampleCount: clip.waveform?.length ?? 0,
        channelCount: clip.waveformChannels?.length ?? null,
        hasSourcePyramid: Boolean(clip.audioState?.sourceAnalysisRefs?.waveformPyramidId),
        hasProcessedPyramid: Boolean(clip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId),
        audioAnalysisJob: clip.audioAnalysisJob ?? null,
      },
      linkedClipId: clip.linkedClipId ?? null,
      linkedSpeed: linkedSpeedPair
        ? {
            followsVideo: isLinkedAudioFollowingVideo(linkedSpeedPair),
            videoClipId: linkedSpeedPair.video.id,
            audioClipId: linkedSpeedPair.audio.id,
          }
        : null,
      isComposition: clip.isComposition === true,
      compositionId: clip.compositionId ?? null,
      nested: clip.isComposition
        ? {
            clipCount: clip.nestedClips?.length ?? 0,
            trackCount: clip.nestedTracks?.length ?? 0,
            hasContentHash: Boolean(clip.nestedContentHash),
            clipBoundariesCount: clip.nestedClipBoundaries?.length ?? 0,
            segmentCount: clip.clipSegments?.length ?? 0,
            clips: clip.nestedClips?.slice(0, 12).map((nestedClip) => ({
              id: nestedClip.id,
              name: nestedClip.name,
              trackId: nestedClip.trackId,
              startTime: nestedClip.startTime,
              duration: nestedClip.duration,
              sourceType: nestedClip.source?.type ?? null,
              isLoading: nestedClip.isLoading ?? false,
              hasVideoElement: Boolean(nestedClip.source?.type === 'video' && nestedClip.source.videoElement),
              hasAudioElement: Boolean(nestedClip.source?.type === 'audio' && nestedClip.source.audioElement),
              isComposition: nestedClip.isComposition === true,
              nestedClipCount: nestedClip.nestedClips?.length ?? 0,
            })) ?? [],
          }
        : null,
      mixdown: {
        hasBuffer: Boolean(clip.mixdownBuffer),
        hasAudioElement: Boolean(clip.mixdownAudio || (clip.source?.type === 'audio' && clip.source.audioElement)),
        waveformSamples: clip.mixdownWaveform?.length ?? 0,
        generating: clip.mixdownGenerating === true,
        hasMixdownAudio: clip.hasMixdownAudio ?? null,
      },
      gaussianSceneKey,
      gaussianSceneLoaded,
      renderDiagnostics,
      gaussianRenderDebug,
      gaussianTargetSummary,
      effects: clip.effects || [],
      masks: clip.masks || [],
      transcript: resolveClipTranscriptWindow(clip),
      analysisStatus: clip.analysisStatus ?? sourceArtifacts.analysisStatus,
      faceAnalysis: {
        status: clip.faceAnalysisStatus ?? sourceArtifacts.faceAnalysisStatus ?? 'none',
        progress: clip.faceAnalysisProgress ?? sourceArtifacts.faceAnalysisProgress ?? 0,
        message: clip.faceAnalysisMessage ?? sourceArtifacts.faceAnalysisMessage ?? null,
        model: analysis?.faceAnalysis
          ? {
              detector: analysis.faceAnalysis.detector,
              recognizer: analysis.faceAnalysis.recognizer,
              version: analysis.faceAnalysis.modelVersion,
              backend: analysis.faceAnalysis.backend,
            }
          : null,
        uniquePeople: analysis?.faceAnalysis?.people.length ?? 0,
        observationCount: analysis?.faceAnalysis?.observationCount ?? 0,
      },
    },
  };
}

export async function handleGetClipsInTimeRange(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const startTime = args.startTime as number;
  const endTime = args.endTime as number;
  const trackType = (args.trackType as string) || 'all';

  const { clips, tracks } = timelineStore;

  const filteredClips = clips.filter(clip => {
    const clipEnd = clip.startTime + clip.duration;
    const overlaps = clip.startTime < endTime && clipEnd > startTime;
    if (!overlaps) return false;

    if (trackType === 'all') return true;
    const track = tracks.find(t => t.id === clip.trackId);
    return track?.type === trackType;
  });

  const clipsWithContexts = filteredClips.map((clip) => ({
    clip,
    resolution: resolveClipInfoAuthoringContext(clip.id, timelineStore),
  }));
  const unresolved = clipsWithContexts.find(({ resolution }) => !resolution?.ok);
  if (unresolved) {
    const unresolvedResolution = unresolved.resolution;
    const reason = !unresolvedResolution || unresolvedResolution.ok
      ? 'owner-not-found'
      : unresolvedResolution.reason;
    return {
      success: false,
      error: `Cannot resolve property authoring context for ${unresolved.clip.id}: ${reason}`,
    };
  }

  return {
    success: true,
    data: {
      clips: clipsWithContexts.map(({ clip, resolution }) => {
        const track = tracks.find(t => t.id === clip.trackId);
        if (!resolution?.ok) throw new Error(`Missing authoring context for ${clip.id}`);
        return formatClipInfo(clip, track, resolution.context);
      }),
      count: filteredClips.length,
    },
  };
}

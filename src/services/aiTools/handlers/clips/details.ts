import type { ToolResult } from '../../types.ts';
import { formatClipInfo } from '../../utils';
import { getGaussianSplatGpuRenderer } from '../../../../engine/gaussian/core/GaussianSplatGpuRenderer';
import { resolveSharedSplatSceneKey } from '../../../../engine/scene/runtime/SharedSplatRuntimeUtils';
import { ensureRenderForDiagnostics } from '../renderOnce';
import type { TimelineStore } from './runtime';

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
      ...formatClipInfo(clip, track),
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
      transcript: clip.transcript,
      analysisStatus: clip.analysisStatus,
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

  return {
    success: true,
    data: {
      clips: filteredClips.map(c => {
        const track = tracks.find(t => t.id === c.trackId);
        return formatClipInfo(c, track);
      }),
      count: filteredClips.length,
    },
  };
}

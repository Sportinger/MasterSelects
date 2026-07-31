import { Logger } from '../../../services/logger';
import type { TimelineClip } from '../../../stores/timeline/types';
import type { Layer } from '../../../types/layers';
import type { ParallelDecodeManager } from '../../ParallelDecodeManager';
import type { BaseLayerPropsLike, ExportClipStateLike } from './contracts';

const log = Logger.create('ExportLayerBuilder');
const FAST_EXPORT_FRAME_LOOKUP_TOLERANCE_MULTIPLIER = 3;

function getExportSourceClipId(clip: TimelineClip): string {
  return (clip as TimelineClip & { exportSourceClipId?: string }).exportSourceClipId ?? clip.id;
}

export function buildVideoLayer(
  clip: TimelineClip,
  baseLayerProps: BaseLayerPropsLike,
  time: number,
  clipStates: Map<string, ExportClipStateLike>,
  parallelDecoder: ParallelDecodeManager | null,
  useParallelDecode: boolean,
  sourceMediaTime?: number,
): Layer | null {
  const clipState = clipStates.get(clip.id);
  const video = clipState?.preciseVideoElement ?? clip.source?.videoElement ?? null;

  if (useParallelDecode) {
    if (!parallelDecoder) {
      throw new Error(`FAST export failed: parallel decoder is not initialized for clip "${clip.name}".`);
    }
    if (parallelDecoder.hasClip(clip.id)) {
      const videoFrame = sourceMediaTime !== undefined
        ? parallelDecoder.getFrameForClipSourceTime(clip.id, sourceMediaTime, {
            toleranceMultiplier: FAST_EXPORT_FRAME_LOOKUP_TOLERANCE_MULTIPLIER,
          })
        : parallelDecoder.getFrameForClip(clip.id, time, {
            toleranceMultiplier: FAST_EXPORT_FRAME_LOOKUP_TOLERANCE_MULTIPLIER,
          });
      if (videoFrame) {
        return {
          ...baseLayerProps,
          source: {
            type: 'video',
            ...(video ? { videoElement: video } : {}),
            videoFrame: videoFrame,
            videoRotation: parallelDecoder.getSourceRotationDegreesForClip?.(clip.id) ?? 0,
            mediaTime: sourceMediaTime,
          },
        };
      }
      throw new Error(`FAST export failed: parallel decode frame not available for clip "${clip.name}" at ${time.toFixed(3)}s.`);
    }
    throw new Error(`FAST export failed: clip "${clip.name}" is not registered in the parallel decoder.`);
  }

  if (clipState?.isSequential && clipState.webCodecsPlayer) {
    const videoFrame = clipState.webCodecsPlayer.getCurrentFrame();
    if (videoFrame) {
      return {
        ...baseLayerProps,
        source: {
          type: 'video',
          ...(video ? { videoElement: video } : {}),
          videoFrame,
          videoRotation: clipState.webCodecsPlayer.getSourceRotationDegrees?.() ?? 0,
          webCodecsPlayer: clipState.webCodecsPlayer,
          mediaTime: sourceMediaTime,
        },
      };
    }
    throw new Error(`FAST export failed: sequential decode frame not available for clip "${clip.name}" at ${time.toFixed(3)}s.`);
  }

  if (!video) {
    throw new Error(
      `PRECISE export failed: no video source is available for clip "${clip.name}" at ${time.toFixed(3)}s.`
    );
  }

  if (video.readyState >= 2) {
    log.debug(`Using HTMLVideoElement export source for clip "${clip.name}" at ${time.toFixed(3)}s`);
    return {
      ...baseLayerProps,
      source: {
        type: 'video',
        videoElement: video,
        mediaTime: sourceMediaTime,
      },
    };
  }

  throw new Error(
    `PRECISE export failed: video source for clip "${clip.name}" is not ready at ` +
    `${time.toFixed(3)}s (readyState=${video.readyState}).`
  );
}

export function buildNestedVideoLayer(
  nestedClip: TimelineClip,
  baseLayer: BaseLayerPropsLike,
  exportVideo: HTMLVideoElement | null,
  mainTimelineTime: number,
  clipStates: Map<string, ExportClipStateLike>,
  parallelDecoder: ParallelDecodeManager | null,
  useParallelDecode: boolean,
  sourceMediaTime?: number,
): Layer | null {
  const sourceClipId = getExportSourceClipId(nestedClip);
  const nestedClipState = clipStates.get(sourceClipId);
  if (useParallelDecode) {
    if (!parallelDecoder) {
      throw new Error(`FAST export failed: parallel decoder is not initialized for nested clip "${nestedClip.name}".`);
    }
    if (parallelDecoder.hasClip(sourceClipId)) {
      const videoFrame = sourceMediaTime !== undefined
        ? parallelDecoder.getFrameForClipSourceTime(sourceClipId, sourceMediaTime, {
            toleranceMultiplier: FAST_EXPORT_FRAME_LOOKUP_TOLERANCE_MULTIPLIER,
          })
        : parallelDecoder.getFrameForClip(sourceClipId, mainTimelineTime, {
            toleranceMultiplier: FAST_EXPORT_FRAME_LOOKUP_TOLERANCE_MULTIPLIER,
          });
      if (videoFrame) {
        return {
          ...baseLayer,
          source: {
            type: 'video',
            ...(exportVideo ? { videoElement: exportVideo } : {}),
            videoFrame,
            videoRotation: parallelDecoder.getSourceRotationDegreesForClip?.(sourceClipId) ?? 0,
            mediaTime: sourceMediaTime,
          },
        };
      }
      throw new Error(`FAST export failed: parallel decode frame not available for nested clip "${nestedClip.name}" at ${mainTimelineTime.toFixed(3)}s.`);
    }
    throw new Error(`FAST export failed: nested clip "${nestedClip.name}" is not registered in the parallel decoder.`);
  }

  if (nestedClipState?.isSequential && nestedClipState.webCodecsPlayer) {
    const videoFrame = nestedClipState.webCodecsPlayer.getCurrentFrame();
    if (videoFrame) {
      return {
        ...baseLayer,
        source: {
          type: 'video',
          ...(exportVideo ? { videoElement: exportVideo } : {}),
          videoFrame,
          videoRotation: nestedClipState.webCodecsPlayer.getSourceRotationDegrees?.() ?? 0,
          webCodecsPlayer: nestedClipState.webCodecsPlayer,
          mediaTime: sourceMediaTime,
        },
      };
    }
    throw new Error(`FAST export failed: sequential decode frame not available for nested clip "${nestedClip.name}" at ${mainTimelineTime.toFixed(3)}s.`);
  }

  if (exportVideo && exportVideo.readyState >= 2) {
    return {
      ...baseLayer,
      source: {
        type: 'video',
        videoElement: exportVideo,
        webCodecsPlayer: nestedClipState?.webCodecsPlayer ?? undefined,
        mediaTime: sourceMediaTime,
      },
    };
  }

  throw new Error(
    `PRECISE export failed: nested video source "${nestedClip.name}" is not ready at ` +
    `${mainTimelineTime.toFixed(3)}s (readyState=${exportVideo?.readyState ?? 'missing'}).`
  );
}

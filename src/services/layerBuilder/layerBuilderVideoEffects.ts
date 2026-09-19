import { useTimelineStore } from '../../stores/timeline';
import { applyCablePreviews } from '../faceCables/cablePreviewRuntime';
import { ANALYSIS_HEIGHT, ANALYSIS_WIDTH } from '../../engine/analysis/opticalFlow/flowStatsMath';
import type { Effect } from '../../types/effects';
import type { TimelineClip } from '../../types/timeline';
import { decorateLandmarkEffects } from '../landmarkTracking/landmarkRuntime';

function resolveOpticalMotion(
  clip: TimelineClip,
  sourceTime: number,
): { x: number; y: number } | undefined {
  const frames = clip.analysis?.frames;
  if (!frames?.length) return undefined;

  let closest = frames[0];
  for (const frame of frames) {
    if (Math.abs(frame.timestamp - sourceTime) < Math.abs(closest.timestamp - sourceTime)) {
      closest = frame;
    }
  }
  if (!Number.isFinite(closest.motionMeanX) || !Number.isFinite(closest.motionMeanY)) {
    return undefined;
  }
  return {
    x: Math.max(-0.25, Math.min(0.25, closest.motionMeanX! / ANALYSIS_WIDTH)),
    y: Math.max(-0.25, Math.min(0.25, closest.motionMeanY! / ANALYSIS_HEIGHT)),
  };
}

export function decorateLayerBuilderVideoEffects(
  clip: TimelineClip,
  localTime: number,
  sourceTime: number,
  effects: Effect[],
): Effect[] {
  const decorated = decorateLandmarkEffects(
    clip.id,
    localTime,
    effects,
    resolveOpticalMotion(clip, sourceTime),
  );
  const state = useTimelineStore.getState();
  return applyCablePreviews(clip.id, localTime, decorated, !state.isExporting && !state.isPlaying);
}

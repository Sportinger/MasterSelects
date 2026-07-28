import type { Keyframe, TimelineClip } from '../../../../types';
import type { OccurrenceMappingIndex } from '../../../../types/agentTimeline/occurrenceMapping';
import { buildOccurrenceMappingIndex } from '../../../../services/agentTimeline/mapping/occurrenceMappingIndex';
import {
  projectCompositionPoint,
  projectSourcePoint,
} from '../../../../services/agentTimeline/mapping/occurrenceMappingQueries';

const COMPOSITION_PATH = ['analysis-workspace'] as const;

export interface AnalysisWorkspaceOccurrenceMapping {
  status: 'ready';
  sourceId: string;
  index: OccurrenceMappingIndex;
}

export interface AnalysisWorkspaceMappingUnavailable {
  status: 'mapping-unavailable';
  reason: string;
}

export type AnalysisWorkspaceTimelineMapping =
  | AnalysisWorkspaceOccurrenceMapping
  | AnalysisWorkspaceMappingUnavailable;

interface BuildAnalysisWorkspaceTimelineMappingInput {
  clip?: TimelineClip;
  sourceId?: string;
  keyframes: readonly Keyframe[];
}

function unavailable(reason: string): AnalysisWorkspaceMappingUnavailable {
  return { status: 'mapping-unavailable', reason };
}

/**
 * Maps one root-timeline clip through the canonical occurrence-mapping index.
 * Transition maps, nested compositions and speed-keyframed clips deliberately
 * remain unavailable: their renderer timing cannot be represented as one
 * selected source occurrence without flattening the composition first.
 */
export function buildAnalysisWorkspaceTimelineMapping(
  input: BuildAnalysisWorkspaceTimelineMappingInput,
): AnalysisWorkspaceTimelineMapping {
  const { clip, sourceId, keyframes } = input;
  if (!clip || !sourceId) return unavailable('The selected clip has no mappable source occurrence.');
  if (clip.isComposition || clip.compositionId || clip.nestedClips?.length) {
    return unavailable('Nested composition timing is not available for this analysis view.');
  }
  if (clip.transitionSourceMap || clip.transitionSourceTimeOverride !== undefined || clip.transitionSourceHold) {
    return unavailable('Transition time remapping is not available for this analysis view.');
  }
  if (keyframes.some(keyframe => keyframe.property === 'speed')) {
    return unavailable('Speed-keyframed clips cannot be mapped exactly in this analysis view.');
  }
  if (![clip.startTime, clip.duration, clip.inPoint, clip.outPoint].every(Number.isFinite)
    || clip.duration <= 0 || clip.outPoint <= clip.inPoint) {
    return unavailable('The selected clip has an invalid time range.');
  }
  const rawSpeed = Number.isFinite(clip.speed) ? clip.speed ?? 1 : 1;
  const speed = Math.abs(rawSpeed);
  if (speed <= 0) return unavailable('Frozen clips cannot be mapped to one source seek.');
  const reverse = clip.reversed === true || rawSpeed < 0;
  const index = buildOccurrenceMappingIndex({
    stateHash: `analysis-workspace:${clip.id}:${clip.startTime}:${clip.duration}:${clip.inPoint}:${clip.outPoint}:${rawSpeed}:${reverse}`,
    occurrences: [{
      sourceId,
      clipId: clip.id,
      compositionPath: COMPOSITION_PATH,
      sourceRange: { start: clip.inPoint, end: clip.outPoint },
      pieces: [{
        compositionStart: clip.startTime,
        compositionEnd: clip.startTime + clip.duration,
        sourceStart: reverse ? clip.outPoint : clip.inPoint,
        sourceRateStart: reverse ? -speed : speed,
      }],
    }],
  });
  return index.segments.length > 0
    ? { status: 'ready', sourceId, index }
    : unavailable('The selected clip has no mappable source coverage.');
}

export function sourceTimeForAnalysisWorkspacePlayhead(
  mapping: AnalysisWorkspaceTimelineMapping,
  timelineTime: number,
): number | undefined {
  if (mapping.status !== 'ready') return undefined;
  return projectCompositionPoint(mapping.index, {
    compositionPath: COMPOSITION_PATH,
    sourceId: mapping.sourceId,
    compositionTime: timelineTime,
  })[0]?.sourceTime;
}

export function timelineTimeForAnalysisWorkspaceSource(
  mapping: AnalysisWorkspaceTimelineMapping,
  sourceTime: number,
): number | undefined {
  if (mapping.status !== 'ready' || !Number.isFinite(sourceTime)) return undefined;
  return projectSourcePoint(mapping.index, {
    sourceId: mapping.sourceId,
    sourceTime,
    compositionPath: COMPOSITION_PATH,
  }).find(point => point.kind === 'point')?.compositionTime;
}

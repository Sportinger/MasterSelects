import type { SceneSegment } from '../../../types/clipMetadata';
import {
  SCENE_CUT_ANALYSIS_SCHEMA_VERSION,
  type SceneCutAnalysis,
  type SceneCutPoint,
} from '../../../types/sceneCutAnalysis';
import {
  AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
  type AgentTimelineEvent,
  type AnalyzerProvenance,
} from '../../../types/agentTimeline/manifest';
import type {
  LegacyArtifactShardView,
  LegacySceneDescriptionRecord,
} from '../../../types/agentTimeline/legacyAdapters';
import {
  clampConfidence,
  createLegacyView,
  intervalOverlaps,
  pointInRange,
  stableLegacyId,
  type LegacyAdapterRequest,
} from './legacyAdapterCore';

function cutProvenance(analysis: SceneCutAnalysis, artifactRef: string | undefined): AnalyzerProvenance {
  return {
    kind: 'analyzer',
    analyzerId: 'scene-cut-detector',
    analyzerVersion: analysis.detectorVersion,
    artifactRef,
  };
}

function cutEvent(
  cut: SceneCutPoint,
  provenance: AnalyzerProvenance,
): AgentTimelineEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id: stableLegacyId('cut', [cut.timestamp, cut.frameNumber]),
    type: 'cut',
    time: {
      temporalKind: 'point',
      timeDomain: 'source',
      time: cut.timestamp,
    },
    confidence: clampConfidence(cut.confidence),
    provenance: [provenance],
    data: {
      score: cut.score,
      transition: 'unknown',
    },
  };
}

export function adaptLegacySceneCuts(
  analysis: SceneCutAnalysis | null | undefined,
  request: LegacyAdapterRequest,
): LegacyArtifactShardView {
  const provenance = analysis ? cutProvenance(analysis, request.artifactRef) : undefined;
  const eventsById = new Map<string, AgentTimelineEvent>();
  for (const cut of analysis?.cuts ?? []) {
    if (!Number.isFinite(cut.timestamp) || cut.timestamp < 0 || !pointInRange(cut.timestamp, request.queryRange)) {
      continue;
    }
    const event = cutEvent(cut, provenance as AnalyzerProvenance);
    if (!eventsById.has(event.id)) eventsById.set(event.id, event);
  }
  const complete = Boolean(analysis
    && analysis.schemaVersion === SCENE_CUT_ANALYSIS_SCHEMA_VERSION
    && analysis.sourceFrameCount >= analysis.expectedSourceFrameCount);
  const coverage = analysis
    ? request.artifactCoverage ?? (complete && analysis.duration > 0
      ? [{ start: 0, end: analysis.duration }]
      : [])
    : [];

  return createLegacyView({
    channel: 'cuts',
    request,
    sourcePresent: Boolean(analysis),
    coverage,
    provenance: provenance ? [provenance] : [],
    events: [...eventsById.values()],
    limitations: analysis && !complete && request.artifactCoverage === undefined
      ? ['coverage-not-recorded']
      : [],
  });
}

export function adaptLegacySceneDescriptions(
  segments: readonly SceneSegment[] | null | undefined,
  request: LegacyAdapterRequest,
): LegacyArtifactShardView<LegacySceneDescriptionRecord> {
  const records = (segments ?? [])
    .filter((segment) => Number.isFinite(segment.start)
      && Number.isFinite(segment.end)
      && segment.start >= 0
      && segment.end > segment.start
      && intervalOverlaps(segment, request.queryRange))
    .map((segment): LegacySceneDescriptionRecord => ({
      kind: 'scene-description',
      segmentId: segment.id,
      start: segment.start,
      end: segment.end,
      text: segment.text,
    }))
    .toSorted((left, right) => left.start - right.start
      || left.end - right.end
      || (left.segmentId < right.segmentId ? -1 : left.segmentId > right.segmentId ? 1 : 0));
  const provenance: AnalyzerProvenance[] = segments === null || segments === undefined
    ? []
    : [{
        kind: 'analyzer',
        analyzerId: 'legacy-scene-description',
        analyzerVersion: 'unversioned',
        artifactRef: request.artifactRef,
      }];
  const sourcePresent = segments !== null && segments !== undefined;
  const coverage = sourcePresent
    ? request.artifactCoverage
      ?? (segments ?? []).map((segment) => ({ start: segment.start, end: segment.end }))
    : [];

  return createLegacyView({
    channel: 'scenes',
    request,
    sourcePresent,
    coverage,
    provenance,
    records,
  });
}

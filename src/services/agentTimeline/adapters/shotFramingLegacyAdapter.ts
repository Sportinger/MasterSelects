import type { ClipAnalysis } from '../../../types/clipMetadata';
import type { SceneCutAnalysis } from '../../../types/sceneCutAnalysis';
import type {
  LegacyArtifactShardView,
} from '../../../types/agentTimeline/legacyAdapters';
import type {
  AgentTimelineProvenance,
  AgentTimelineRange,
} from '../../../types/agentTimeline/manifest';
import type {
  ShotBoundaryInput,
  ShotFaceFrameSample,
} from '../../../types/agentTimeline/visualDerivations';
import { deriveShotFramingEvents } from '../derivations/visual/shotFramingDerivation';
import {
  createLegacyView,
  stableLegacyId,
  type LegacyAdapterRequest,
} from './legacyAdapterCore';

function clippedRange(
  range: AgentTimelineRange,
  query: AgentTimelineRange,
): AgentTimelineRange | undefined {
  const start = Math.max(range.start, query.start);
  const end = Math.min(range.end, query.end);
  return start < end ? { start, end } : undefined;
}

function shotBoundaries(
  cuts: SceneCutAnalysis,
  query: AgentTimelineRange,
): ShotBoundaryInput[] {
  const boundaries = [
    0,
    ...cuts.cuts
      .map((cut) => cut.timestamp)
      .filter((time) => Number.isFinite(time) && time > 0 && time < cuts.duration),
    cuts.duration,
  ].toSorted((left, right) => left - right)
    .filter((time, index, values) => index === 0 || time > values[index - 1]);
  return boundaries.slice(0, -1).flatMap((start, index) => {
    const end = boundaries[index + 1];
    const visible = clippedRange({ start, end }, query);
    return visible ? [{
      shotId: stableLegacyId('shot', [index, start, end]),
      index,
      ...visible,
    }] : [];
  });
}

function faceSamples(
  analysis: ClipAnalysis,
  query: AgentTimelineRange,
): ShotFaceFrameSample[] {
  return analysis.frames.flatMap((frame) => (
    Number.isFinite(frame.timestamp)
      && frame.timestamp >= query.start
      && frame.timestamp < query.end
      ? [{
          time: frame.timestamp,
          faces: (frame.faces ?? []).map((face) => ({
            id: face.id,
            sourcePersonId: face.personId,
            confidence: face.confidence,
            identityEligible: face.identityEligible !== false,
            box: { ...face.box },
          })),
        }]
      : []
  ));
}

function coverage(
  analysis: ClipAnalysis,
  query: AgentTimelineRange,
): AgentTimelineRange[] {
  const duration = Number.isFinite(analysis.sampleInterval) && analysis.sampleInterval > 0
    ? analysis.sampleInterval / 1000
    : 0;
  if (duration <= 0) return [];
  return analysis.frames.flatMap((frame) => {
    if (!Number.isFinite(frame.timestamp)) return [];
    const visible = clippedRange(
      { start: frame.timestamp, end: frame.timestamp + duration },
      query,
    );
    return visible ? [visible] : [];
  });
}

export function adaptLegacyShotFraming(
  analysis: ClipAnalysis | null | undefined,
  cuts: SceneCutAnalysis | null | undefined,
  request: LegacyAdapterRequest,
): LegacyArtifactShardView {
  const sourcePresent = Boolean(analysis && cuts);
  const provenance: AgentTimelineProvenance[] = sourcePresent ? [
    {
      kind: 'analyzer',
      analyzerId: 'shot-framing-derivation',
      analyzerVersion: 'shot-framing-derivation/v1',
      artifactRef: request.artifactRef,
    },
    {
      kind: 'analyzer',
      analyzerId: 'scene-cut-detector',
      analyzerVersion: cuts!.detectorVersion,
    },
  ] : [];
  const events = sourcePresent
    ? deriveShotFramingEvents(
      shotBoundaries(cuts!, request.queryRange),
      faceSamples(analysis!, request.queryRange),
      { provenance },
    )
    : [];

  return createLegacyView({
    channel: 'shots',
    request,
    sourcePresent,
    coverage: sourcePresent ? coverage(analysis!, request.queryRange) : [],
    provenance,
    events,
    limitations: sourcePresent && events.length === 0 ? ['coverage-not-recorded'] : [],
  });
}

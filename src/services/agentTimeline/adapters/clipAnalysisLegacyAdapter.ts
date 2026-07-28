import type {
  ClipAnalysis,
  FaceFrameDetection,
  FacePersonSummary,
  FrameAnalysisData,
} from '../../../types/clipMetadata';
import {
  AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
  type AgentTimelineEvent,
  type AgentTimelineProvenance,
  type AgentTimelineRange,
} from '../../../types/agentTimeline/manifest';
import type {
  LegacyArtifactShardView,
  LegacyFaceSampleRecord,
  LegacyFocusSampleRecord,
  LegacyMotionSampleRecord,
} from '../../../types/agentTimeline/legacyAdapters';
import {
  clampConfidence,
  createLegacyView,
  pointInRange,
  stableLegacyId,
  type LegacyAdapterRequest,
} from './legacyAdapterCore';
import { deriveCameraMotionSpans } from '../derivations/visual/cameraMotionDerivation';
import { deriveQualityAudioEvents } from '../derivations/qualityAudio/deriveQualityAudioEvents';

export interface LegacyClipAnalysisViews {
  quality: LegacyArtifactShardView<LegacyFocusSampleRecord>;
  cameraMotion: LegacyArtifactShardView<LegacyMotionSampleRecord>;
  people: LegacyArtifactShardView<LegacyFaceSampleRecord>;
}

function validFrames(analysis: ClipAnalysis): FrameAnalysisData[] {
  return analysis.frames
    .filter((frame) => Number.isFinite(frame.timestamp) && frame.timestamp >= 0)
    .toSorted((left, right) => left.timestamp - right.timestamp);
}

function frameCoverage(analysis: ClipAnalysis, frames: readonly FrameAnalysisData[]): AgentTimelineRange[] {
  const sampleDuration = Number.isFinite(analysis.sampleInterval) && analysis.sampleInterval > 0
    ? analysis.sampleInterval / 1000
    : 0;
  return sampleDuration === 0
    ? []
    : frames.map((frame) => ({ start: frame.timestamp, end: frame.timestamp + sampleDuration }));
}

function metricProvenance(request: LegacyAdapterRequest): AgentTimelineProvenance[] {
  return [{
    kind: 'analyzer',
    analyzerId: 'legacy-clip-analysis',
    analyzerVersion: 'unversioned',
    artifactRef: request.artifactRef,
  }];
}

function faceProvenance(
  analysis: ClipAnalysis,
  request: LegacyAdapterRequest,
): AgentTimelineProvenance[] {
  const face = analysis.faceAnalysis;
  return [{
    kind: 'analyzer',
    analyzerId: face ? `${face.detector.toLowerCase()}-${face.recognizer.toLowerCase()}` : 'legacy-frame-faces',
    analyzerVersion: face ? String(face.schemaVersion) : 'unversioned',
    modelId: face ? `${face.detector}+${face.recognizer}` : undefined,
    modelVersion: face?.modelVersion,
    artifactRef: request.artifactRef,
  }];
}

function faceEvent(
  person: FacePersonSummary,
  appearance: AgentTimelineRange,
  provenance: AgentTimelineProvenance[],
): AgentTimelineEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id: stableLegacyId('person-visible', [person.id, appearance.start, appearance.end]),
    type: 'person-visible',
    time: {
      temporalKind: 'interval',
      timeDomain: 'source',
      start: appearance.start,
      end: appearance.end,
    },
    confidence: clampConfidence(person.averageConfidence),
    provenance,
    data: { personId: person.id },
  };
}

function detectionRecord(frame: FrameAnalysisData, detection: FaceFrameDetection): LegacyFaceSampleRecord {
  return {
    kind: 'face-sample',
    time: frame.timestamp,
    detectionId: detection.id,
    personId: detection.personId,
    confidence: clampConfidence(detection.confidence),
    identityEligible: detection.identityEligible !== false,
    box: { ...detection.box },
  };
}

export function adaptLegacyClipAnalysis(
  analysis: ClipAnalysis | null | undefined,
  request: LegacyAdapterRequest,
): LegacyClipAnalysisViews {
  const frames = analysis ? validFrames(analysis) : [];
  const visibleFrames = frames.filter((frame) => pointInRange(frame.timestamp, request.queryRange));
  const coverage = analysis ? frameCoverage(analysis, frames) : [];
  const provenance = metricProvenance(request);
  const defaultSampleDuration = analysis && Number.isFinite(analysis.sampleInterval)
    && analysis.sampleInterval > 0
    ? analysis.sampleInterval / 1000
    : 0.5;
  const qualityRecords = visibleFrames.map((frame): LegacyFocusSampleRecord => ({
    kind: 'focus-brightness-sample',
    time: frame.timestamp,
    focus: frame.focus,
    brightness: frame.brightness,
  }));
  const motionRecords = visibleFrames.map((frame): LegacyMotionSampleRecord => ({
    kind: 'motion-sample',
    time: frame.timestamp,
    motion: frame.motion,
    globalMotion: frame.globalMotion,
    localMotion: frame.localMotion,
    ...(frame.motionMeanMagnitude !== undefined
      ? { meanMagnitude: frame.motionMeanMagnitude } : {}),
    ...(frame.motionMeanX !== undefined ? { meanX: frame.motionMeanX } : {}),
    ...(frame.motionMeanY !== undefined ? { meanY: frame.motionMeanY } : {}),
    ...(frame.motionDirectionCoherence !== undefined
      ? { directionCoherence: frame.motionDirectionCoherence } : {}),
    ...(frame.motionCoverageRatio !== undefined
      ? { coverageRatio: frame.motionCoverageRatio } : {}),
    ...(frame.motionVectorConvention
      ? { vectorConvention: frame.motionVectorConvention } : {}),
  }));
  const qualityEvents = analysis ? deriveQualityAudioEvents({
    sourceId: request.artifactRef ?? 'legacy-clip-analysis',
    timeDomain: 'source',
    range: request.queryRange,
    quality: {
      samples: visibleFrames.map((frame) => ({
        time: frame.timestamp,
        focus: frame.focus,
        brightness: frame.brightness,
      })),
      coverage,
      provenance: {
        analyzerId: 'legacy-clip-analysis',
        analyzerVersion: 'unversioned',
        artifactRefs: request.artifactRef ? [request.artifactRef] : undefined,
      },
    },
  }).events : [];
  const motionEvents = analysis ? deriveCameraMotionSpans(
    visibleFrames.map((frame) => ({
      time: frame.timestamp,
      globalMotion: frame.globalMotion,
      localMotion: frame.localMotion,
      meanMagnitude: frame.motionMeanMagnitude,
      meanX: frame.motionMeanX,
      meanY: frame.motionMeanY,
      directionCoherence: frame.motionDirectionCoherence,
      coverageRatio: frame.motionCoverageRatio,
      vectorConvention: frame.motionVectorConvention,
      isSceneCut: frame.isSceneCut,
    })),
    {
      defaultSampleDuration,
      range: request.queryRange,
      provenance,
    },
  ) : [];
  const faces = visibleFrames.flatMap((frame) => (
    (frame.faces ?? []).map((detection) => detectionRecord(frame, detection))
  ));
  const peopleProvenance = analysis ? faceProvenance(analysis, request) : [];
  const events = (analysis?.faceAnalysis?.people ?? []).flatMap((person) => (
    person.appearances
      .filter((appearance) => appearance.start < appearance.end
        && appearance.start < request.queryRange.end
        && appearance.end > request.queryRange.start)
      .map((appearance) => faceEvent(person, appearance, peopleProvenance))
  ));
  const faceDataPresent = Boolean(analysis && (
    analysis.faceAnalysis
    || frames.some((frame) => (frame.faces?.length ?? 0) > 0)
  ));

  return {
    quality: createLegacyView({
      channel: 'quality',
      request,
      sourcePresent: Boolean(analysis),
      coverage,
      provenance: analysis ? provenance : [],
      events: qualityEvents,
      records: qualityRecords,
    }),
    cameraMotion: createLegacyView({
      channel: 'camera-motion',
      request,
      sourcePresent: Boolean(analysis),
      coverage,
      provenance: analysis ? provenance : [],
      events: motionEvents,
      records: motionRecords,
    }),
    people: createLegacyView({
      channel: 'people',
      request,
      sourcePresent: faceDataPresent,
      coverage: faceDataPresent ? coverage : [],
      provenance: faceDataPresent ? peopleProvenance : [],
      events,
      records: faces,
      rangeCapability: 'source-wide-only',
      limitations: ['face-identity-source-wide-only'],
      forceStatus: faceDataPresent ? 'partial' : 'missing',
    }),
  };
}

import type { AudioAnalysisArtifactKind } from "../../types/audio";
import {
  getCachedTimelineBeatGrid,
  getCachedTimelineOnsetMap,
} from '../audio/timelineBeatOnsetCache';
import {
  getCachedTimelineFrequencySummary,
  getCachedTimelinePhaseCorrelation,
} from '../audio/timelineFrequencyPhaseCache';
import { getCachedTimelineLoudnessEnvelope } from '../audio/timelineLoudnessEnvelopeCache';

export interface AINodeRuntimeAudioArtifactSignal {
  artifactId: string;
  kind: AudioAnalysisArtifactKind;
  provenance: 'source' | 'processed';
  available: true;
  stale: boolean;
  loudnessSummary?: AINodeRuntimeLoudnessSummary;
  beatGridSummary?: AINodeRuntimeBeatGridSummary;
  onsetMapSummary?: AINodeRuntimeOnsetMapSummary;
  phaseCorrelationSummary?: AINodeRuntimePhaseCorrelationSummary;
  frequencyBandSummary?: AINodeRuntimeFrequencyBandSummary;
}

interface AINodeRuntimeLoudnessCurvePreview {
  metric: string;
  pointCount: number;
  minDb: number;
  maxDb: number;
  previewDb: number[];
}

interface AINodeRuntimeLoudnessSummary {
  integratedLufs?: number;
  truePeakDbtp?: number;
  samplePeakDbfs?: number;
  rmsDbfs?: number;
  curves: AINodeRuntimeLoudnessCurvePreview[];
}

interface AINodeRuntimeFrequencyBandSummary {
  spectralCentroidHz: number;
  lowEnergyShare: number;
  midEnergyShare: number;
  highEnergyShare: number;
  dominantBandId?: string;
  bands: Array<{
    bandId: string;
    label: string;
    minFrequency: number;
    maxFrequency: number;
    rmsDb: number;
    peakDb: number;
    energyShare: number;
    centroidHz: number;
  }>;
}

interface AINodeRuntimePhaseCorrelationSummary {
  averageCorrelation: number;
  minimumCorrelation: number;
  maximumCorrelation: number;
  negativeCorrelationPercent: number;
  averageMidSideRatioDb: number;
  stereoWidth: number;
  monoCompatible: boolean;
  pointCount: number;
  preview: Array<{
    time: number;
    correlation: number;
    midSideRatioDb: number;
  }>;
}

interface AINodeRuntimeAudioEventPreview {
  time: number;
  strength: number;
  confidence: number;
}

interface AINodeRuntimeBeatGridSummary {
  tempoBpm?: number;
  beatCount: number;
  confidence: number;
  preview: AINodeRuntimeAudioEventPreview[];
}

interface AINodeRuntimeOnsetMapSummary {
  eventCount: number;
  averageStrength: number;
  peakStrength: number;
  preview: AINodeRuntimeAudioEventPreview[];
}

function roundAudioValue(value: number, decimals = 4): number {
  return Number.isFinite(value) ? Number(value.toFixed(decimals)) : value;
}

function roundAudioDb(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : value;
}

function createPreview(values: Float32Array, maxPoints: number): number[] {
  if (values.length === 0) {
    return [];
  }

  const count = Math.min(maxPoints, values.length);
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.min(
      values.length - 1,
      Math.floor((index / Math.max(1, count - 1)) * (values.length - 1)),
    );
    return roundAudioDb(values[sourceIndex] ?? 0);
  });
}

function createAudioEventPreview(
  events: readonly { time: number; strength: number; confidence: number }[],
  maxPoints: number,
): AINodeRuntimeAudioEventPreview[] {
  if (events.length === 0) {
    return [];
  }

  const count = Math.min(maxPoints, events.length);
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.min(
      events.length - 1,
      Math.floor((index / Math.max(1, count - 1)) * (events.length - 1)),
    );
    const event = events[sourceIndex] ?? { time: 0, strength: 0, confidence: 0 };
    return {
      time: roundAudioValue(event.time, 3),
      strength: roundAudioValue(event.strength),
      confidence: roundAudioValue(event.confidence),
    };
  });
}

function createCachedBeatGridSummary(artifactId: string): AINodeRuntimeBeatGridSummary | undefined {
  const grid = getCachedTimelineBeatGrid(artifactId);
  if (!grid) {
    return undefined;
  }

  return {
    tempoBpm: grid.tempoBpm === undefined ? undefined : roundAudioValue(grid.tempoBpm, 2),
    beatCount: grid.beatCount,
    confidence: roundAudioValue(grid.summary.confidence),
    preview: createAudioEventPreview(grid.beats, 32),
  };
}

function createCachedOnsetMapSummary(artifactId: string): AINodeRuntimeOnsetMapSummary | undefined {
  const map = getCachedTimelineOnsetMap(artifactId);
  if (!map) {
    return undefined;
  }

  return {
    eventCount: map.eventCount,
    averageStrength: roundAudioValue(map.summary.averageStrength),
    peakStrength: roundAudioValue(map.summary.peakStrength),
    preview: createAudioEventPreview(map.onsets, 32),
  };
}

function createCachedLoudnessSummary(artifactId: string): AINodeRuntimeLoudnessSummary | undefined {
  const envelope = getCachedTimelineLoudnessEnvelope(artifactId);
  if (!envelope) {
    return undefined;
  }

  return {
    integratedLufs: envelope.summary?.integratedLufs === undefined
      ? undefined
      : roundAudioDb(envelope.summary.integratedLufs),
    truePeakDbtp: envelope.summary?.truePeakDbtp === undefined
      ? undefined
      : roundAudioDb(envelope.summary.truePeakDbtp),
    samplePeakDbfs: envelope.summary?.samplePeakDbfs === undefined
      ? undefined
      : roundAudioDb(envelope.summary.samplePeakDbfs),
    rmsDbfs: envelope.summary?.rmsDbfs === undefined
      ? undefined
      : roundAudioDb(envelope.summary.rmsDbfs),
    curves: envelope.curves.slice(0, 8).map((curve) => {
      let minDb = Number.POSITIVE_INFINITY;
      let maxDb = Number.NEGATIVE_INFINITY;
      for (const value of curve.values) {
        const finite = Number.isFinite(value) ? value : 0;
        minDb = Math.min(minDb, finite);
        maxDb = Math.max(maxDb, finite);
      }

      return {
        metric: curve.metric,
        pointCount: curve.pointCount,
        minDb: roundAudioDb(minDb === Number.POSITIVE_INFINITY ? 0 : minDb),
        maxDb: roundAudioDb(maxDb === Number.NEGATIVE_INFINITY ? 0 : maxDb),
        previewDb: createPreview(curve.values, 32),
      };
    }),
  };
}

function createCachedFrequencyBandSummary(artifactId: string): AINodeRuntimeFrequencyBandSummary | undefined {
  const summary = getCachedTimelineFrequencySummary(artifactId);
  if (!summary) {
    return undefined;
  }

  return {
    spectralCentroidHz: roundAudioValue(summary.summary.spectralCentroidHz, 2),
    lowEnergyShare: roundAudioValue(summary.summary.lowEnergyShare),
    midEnergyShare: roundAudioValue(summary.summary.midEnergyShare),
    highEnergyShare: roundAudioValue(summary.summary.highEnergyShare),
    dominantBandId: summary.summary.dominantBandId,
    bands: summary.bands.slice(0, 12).map((band) => ({
      bandId: band.bandId,
      label: band.label,
      minFrequency: roundAudioValue(band.minFrequency, 2),
      maxFrequency: roundAudioValue(band.maxFrequency, 2),
      rmsDb: roundAudioDb(band.rmsDb),
      peakDb: roundAudioDb(band.peakDb),
      energyShare: roundAudioValue(band.energyShare),
      centroidHz: roundAudioValue(band.centroidHz, 2),
    })),
  };
}

function createPhaseCorrelationPreview(
  points: NonNullable<ReturnType<typeof getCachedTimelinePhaseCorrelation>>['points'],
  maxPoints: number,
): AINodeRuntimePhaseCorrelationSummary['preview'] {
  if (points.length === 0) {
    return [];
  }

  const count = Math.min(maxPoints, points.length);
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.min(
      points.length - 1,
      Math.floor((index / Math.max(1, count - 1)) * (points.length - 1)),
    );
    const point = points[sourceIndex] ?? { time: 0, correlation: 1, midSideRatioDb: 0 };
    return {
      time: roundAudioValue(point.time, 3),
      correlation: roundAudioValue(point.correlation),
      midSideRatioDb: roundAudioDb(point.midSideRatioDb),
    };
  });
}

function createCachedPhaseCorrelationSummary(artifactId: string): AINodeRuntimePhaseCorrelationSummary | undefined {
  const phase = getCachedTimelinePhaseCorrelation(artifactId);
  if (!phase) {
    return undefined;
  }

  return {
    averageCorrelation: roundAudioValue(phase.summary.averageCorrelation),
    minimumCorrelation: roundAudioValue(phase.summary.minimumCorrelation),
    maximumCorrelation: roundAudioValue(phase.summary.maximumCorrelation),
    negativeCorrelationPercent: roundAudioValue(phase.summary.negativeCorrelationPercent),
    averageMidSideRatioDb: roundAudioDb(phase.summary.averageMidSideRatioDb),
    stereoWidth: roundAudioValue(phase.summary.stereoWidth),
    monoCompatible: phase.summary.monoCompatible,
    pointCount: phase.points.length,
    preview: createPhaseCorrelationPreview(phase.points, 32),
  };
}

export function createAudioArtifactSignal(
  artifactId: string | undefined,
  kind: AudioAnalysisArtifactKind,
  provenance: 'source' | 'processed',
): AINodeRuntimeAudioArtifactSignal | undefined {
  if (!artifactId) {
    return undefined;
  }

  const loudnessSummary = kind === 'loudness-envelope'
    ? createCachedLoudnessSummary(artifactId)
    : undefined;
  const beatGridSummary = kind === 'beat-grid'
    ? createCachedBeatGridSummary(artifactId)
    : undefined;
  const onsetMapSummary = kind === 'onset-map'
    ? createCachedOnsetMapSummary(artifactId)
    : undefined;
  const phaseCorrelationSummary = kind === 'phase-correlation'
    ? createCachedPhaseCorrelationSummary(artifactId)
    : undefined;
  const frequencyBandSummary = kind === 'frequency-summary'
    ? createCachedFrequencyBandSummary(artifactId)
    : undefined;

  return {
    artifactId,
    kind,
    provenance,
    available: true,
    stale: false,
    ...(loudnessSummary ? { loudnessSummary } : {}),
    ...(beatGridSummary ? { beatGridSummary } : {}),
    ...(onsetMapSummary ? { onsetMapSummary } : {}),
    ...(phaseCorrelationSummary ? { phaseCorrelationSummary } : {}),
    ...(frequencyBandSummary ? { frequencyBandSummary } : {}),
  };
}

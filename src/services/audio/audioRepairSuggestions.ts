import type { MediaFileAudioAnalysisRefs } from '../../types/audio';
import type { TimelineLoudnessEnvelope } from './timelineLoudnessEnvelopeCache';
import { getCachedTimelineLoudnessEnvelope } from './timelineLoudnessEnvelopeCache';
import type {
  TimelineFrequencySummary,
  TimelinePhaseCorrelation,
} from './timelineFrequencyPhaseCache';
import {
  getCachedTimelineFrequencySummary,
  getCachedTimelinePhaseCorrelation,
} from './timelineFrequencyPhaseCache';

export type AudioRepairSuggestionKind =
  | 'hum-notch'
  | 'de-click'
  | 'loudness-match'
  | 'mono-compatibility';

export type AudioRepairSuggestionSeverity = 'info' | 'warning' | 'critical';

export interface AudioRepairSuggestionOperation {
  editType: 'repair' | 'mono-sum';
  params: Record<string, string | number | boolean>;
}

export interface AudioRepairSuggestion {
  id: string;
  kind: AudioRepairSuggestionKind;
  label: string;
  severity: AudioRepairSuggestionSeverity;
  confidence: number;
  reason: string;
  operation: AudioRepairSuggestionOperation;
  evidence: Record<string, string | number | boolean>;
}

export interface AudioRepairSuggestionInput {
  loudness?: TimelineLoudnessEnvelope | null;
  frequency?: TimelineFrequencySummary | null;
  phase?: TimelinePhaseCorrelation | null;
  maxSuggestions?: number;
}

const DEFAULT_MAX_SUGGESTIONS = 6;

function finite(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function round(value: number, decimals = 3): number {
  return Number(value.toFixed(decimals));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function severityRank(severity: AudioRepairSuggestionSeverity): number {
  switch (severity) {
    case 'critical': return 3;
    case 'warning': return 2;
    case 'info': return 1;
  }
}

function createSuggestion(
  kind: AudioRepairSuggestionKind,
  input: Omit<AudioRepairSuggestion, 'id' | 'kind'>,
): AudioRepairSuggestion {
  return {
    id: `audio-repair:${kind}`,
    kind,
    ...input,
    confidence: round(clamp01(input.confidence), 2),
  };
}

function loudnessSuggestion(loudness: TimelineLoudnessEnvelope): AudioRepairSuggestion | null {
  const summary = loudness.summary;
  const integratedLufs = finite(summary?.integratedLufs);
  const rmsDbfs = finite(summary?.rmsDbfs);
  const loudnessDb = integratedLufs ?? rmsDbfs;
  if (loudnessDb === undefined) {
    return null;
  }

  const truePeakDbtp = finite(summary?.truePeakDbtp);
  const tooQuiet = loudnessDb < -24;
  const tooHot = loudnessDb > -13;
  const peakHot = truePeakDbtp !== undefined && truePeakDbtp > -1;
  if (!tooQuiet && !tooHot && !peakHot) {
    return null;
  }

  const targetDb = tooHot || peakHot ? -18 : -20;
  const distance = Math.abs(loudnessDb - targetDb);
  const severity: AudioRepairSuggestionSeverity = peakHot || distance > 10 ? 'warning' : 'info';
  const reason = peakHot
    ? `True peak is ${round(truePeakDbtp!, 2)} dBTP, which leaves little export headroom.`
    : `Measured loudness is ${round(loudnessDb, 2)} dB, outside the normal dialog/editing range.`;

  return createSuggestion('loudness-match', {
    label: 'Match loudness',
    severity,
    confidence: 0.64 + Math.min(0.3, distance / 30),
    reason,
    operation: {
      editType: 'repair',
      params: {
        repairType: 'loudness-match',
        targetDb,
        minGainDb: -24,
        maxGainDb: 24,
        featherTime: 0.01,
      },
    },
    evidence: {
      ...(integratedLufs !== undefined ? { integratedLufs: round(integratedLufs, 2) } : {}),
      ...(rmsDbfs !== undefined ? { rmsDbfs: round(rmsDbfs, 2) } : {}),
      ...(truePeakDbtp !== undefined ? { truePeakDbtp: round(truePeakDbtp, 2) } : {}),
      targetDb,
    },
  });
}

function bandOverlapsFrequency(
  band: TimelineFrequencySummary['bands'][number],
  frequencyHz: number,
): boolean {
  return band.minFrequency <= frequencyHz + 4 && band.maxFrequency >= frequencyHz - 4;
}

function strongestHumCandidate(frequency: TimelineFrequencySummary): {
  baseFrequencyHz: 50 | 60;
  energyShare: number;
  peakDb: number;
  bandLabel: string;
} | null {
  const candidates = ([50, 60] as const)
    .map((baseFrequencyHz) => {
      const fundamental = frequency.bands.find(band => bandOverlapsFrequency(band, baseFrequencyHz));
      const secondHarmonic = frequency.bands.find(band => bandOverlapsFrequency(band, baseFrequencyHz * 2));
      if (!fundamental && !secondHarmonic) {
        return null;
      }
      const energyShare = Math.max(
        fundamental?.energyShare ?? 0,
        secondHarmonic?.energyShare ? secondHarmonic.energyShare * 0.8 : 0,
      );
      const peakDb = Math.max(
        fundamental?.peakDb ?? Number.NEGATIVE_INFINITY,
        secondHarmonic?.peakDb ?? Number.NEGATIVE_INFINITY,
      );
      return {
        baseFrequencyHz,
        energyShare,
        peakDb,
        bandLabel: fundamental?.label ?? secondHarmonic?.label ?? `${baseFrequencyHz} Hz`,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .toSorted((a, b) => b.energyShare - a.energyShare || b.peakDb - a.peakDb);

  return candidates[0] ?? null;
}

function humSuggestion(frequency: TimelineFrequencySummary): AudioRepairSuggestion | null {
  const candidate = strongestHumCandidate(frequency);
  if (!candidate) {
    return null;
  }

  const lowDominant = frequency.summary.lowEnergyShare > 0.38 && frequency.summary.spectralCentroidHz < 550;
  const humLike = candidate.energyShare > 0.13 || (lowDominant && candidate.energyShare > 0.07);
  const peakAudible = candidate.peakDb > -42;
  if (!humLike || !peakAudible) {
    return null;
  }

  const confidence = 0.52 + Math.min(0.35, candidate.energyShare) + (lowDominant ? 0.08 : 0);
  return createSuggestion('hum-notch', {
    label: `${candidate.baseFrequencyHz} Hz hum notch`,
    severity: candidate.energyShare > 0.2 ? 'warning' : 'info',
    confidence,
    reason: `${candidate.bandLabel} carries concentrated low-frequency energy that matches mains hum.`,
    operation: {
      editType: 'repair',
      params: {
        repairType: 'hum-notch',
        baseFrequencyHz: candidate.baseFrequencyHz,
        harmonicCount: 6,
        q: 35,
        featherTime: 0.02,
      },
    },
    evidence: {
      baseFrequencyHz: candidate.baseFrequencyHz,
      energyShare: round(candidate.energyShare),
      peakDb: round(candidate.peakDb, 2),
      spectralCentroidHz: round(frequency.summary.spectralCentroidHz, 1),
      lowEnergyShare: round(frequency.summary.lowEnergyShare),
    },
  });
}

function deClickSuggestion(loudness: TimelineLoudnessEnvelope): AudioRepairSuggestion | null {
  const summary = loudness.summary;
  const samplePeakDbfs = finite(summary?.samplePeakDbfs);
  const truePeakDbtp = finite(summary?.truePeakDbtp);
  const rmsDbfs = finite(summary?.rmsDbfs);
  const peakDb = truePeakDbtp ?? samplePeakDbfs;
  if (peakDb === undefined || rmsDbfs === undefined) {
    return null;
  }

  const crestDb = peakDb - rmsDbfs;
  if (crestDb < 22 || peakDb < -3) {
    return null;
  }

  return createSuggestion('de-click', {
    label: 'De-click transients',
    severity: peakDb > -0.3 ? 'warning' : 'info',
    confidence: 0.58 + Math.min(0.28, (crestDb - 22) / 35),
    reason: `Peak-to-RMS distance is ${round(crestDb, 2)} dB, which can indicate isolated click spikes.`,
    operation: {
      editType: 'repair',
      params: {
        repairType: 'de-click',
        threshold: 0.35,
        ratio: 4,
      },
    },
    evidence: {
      peakDb: round(peakDb, 2),
      rmsDbfs: round(rmsDbfs, 2),
      crestDb: round(crestDb, 2),
    },
  });
}

function phaseSuggestion(phase: TimelinePhaseCorrelation): AudioRepairSuggestion | null {
  const negativePct = finite(phase.summary.negativeCorrelationPercent) ?? 0;
  const minimumCorrelation = finite(phase.summary.minimumCorrelation) ?? 1;
  const stereoWidth = finite(phase.summary.stereoWidth) ?? 0;
  if (phase.summary.monoCompatible && negativePct < 8 && minimumCorrelation > -0.2) {
    return null;
  }

  return createSuggestion('mono-compatibility', {
    label: 'Check mono compatibility',
    severity: negativePct > 18 || minimumCorrelation < -0.45 ? 'warning' : 'info',
    confidence: 0.6 + Math.min(0.25, negativePct / 100) + (minimumCorrelation < 0 ? 0.08 : 0),
    reason: `Phase correlation drops to ${round(minimumCorrelation)} with ${round(negativePct, 2)}% negative-correlation windows.`,
    operation: {
      editType: 'mono-sum',
      params: {
        label: 'Mono compatibility repair',
        preserveClipDuration: true,
      },
    },
    evidence: {
      negativeCorrelationPercent: round(negativePct, 2),
      minimumCorrelation: round(minimumCorrelation),
      averageCorrelation: round(phase.summary.averageCorrelation),
      stereoWidth: round(stereoWidth),
      monoCompatible: phase.summary.monoCompatible,
    },
  });
}

export function buildAudioRepairSuggestions(
  input: AudioRepairSuggestionInput,
): AudioRepairSuggestion[] {
  const suggestions = [
    input.loudness ? loudnessSuggestion(input.loudness) : null,
    input.loudness ? deClickSuggestion(input.loudness) : null,
    input.frequency ? humSuggestion(input.frequency) : null,
    input.phase ? phaseSuggestion(input.phase) : null,
  ].filter((suggestion): suggestion is AudioRepairSuggestion => Boolean(suggestion));

  const maxSuggestions = Math.max(1, Math.min(16, input.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS));
  return suggestions
    .toSorted((a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      b.confidence - a.confidence ||
      a.kind.localeCompare(b.kind)
    )
    .slice(0, maxSuggestions);
}

export function buildAudioRepairSuggestionsFromRefs(
  refs: MediaFileAudioAnalysisRefs | undefined,
  options: { maxSuggestions?: number } = {},
): AudioRepairSuggestion[] {
  if (!refs) {
    return [];
  }

  return buildAudioRepairSuggestions({
    loudness: getCachedTimelineLoudnessEnvelope(refs.loudnessEnvelopeId),
    frequency: getCachedTimelineFrequencySummary(refs.frequencySummaryId),
    phase: getCachedTimelinePhaseCorrelation(refs.phaseCorrelationId),
    maxSuggestions: options.maxSuggestions,
  });
}

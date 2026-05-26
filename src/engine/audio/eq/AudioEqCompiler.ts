import { createAudioEqBiquadCascadeCoefficients } from './AudioEqBiquad';
import { normalizeAudioEqParams } from './AudioEqLegacy';
import type {
  AudioEqBand,
  AudioEqCompilerDiagnostic,
  AudioEqParamsV2,
  CompiledAudioEqBandPlan,
  CompiledAudioEqPlan,
} from './AudioEqTypes';

export const AUDIO_EQ_DEFAULT_SAMPLE_RATE = 48_000;
export const AUDIO_EQ_LINEAR_PHASE_LATENCY_SAMPLES = 2048;

function isSupportedSlope(slopeDbPerOct: number | undefined): boolean {
  return slopeDbPerOct === undefined || (slopeDbPerOct >= 0.1 && slopeDbPerOct <= 120);
}

function diagnostic(
  code: string,
  message: string,
  bandId?: string,
  severity: AudioEqCompilerDiagnostic['severity'] = 'warning',
): AudioEqCompilerDiagnostic {
  return { severity, code, message, ...(bandId ? { bandId } : {}) };
}

function compileBand(
  band: AudioEqBand,
  sampleRate: number,
  diagnostics: AudioEqCompilerDiagnostic[],
): CompiledAudioEqBandPlan | null {
  if (!band.enabled) {
    return null;
  }

  if (band.stereoMode === 'surround') {
    diagnostics.push(diagnostic(
      'audio-eq-surround-band-unsupported',
      'Surround-targeted EQ bands are reserved in schema but not compiled yet.',
      band.id,
    ));
    return null;
  }

  if (band.dynamic?.enabled) {
    diagnostics.push(diagnostic(
      'audio-eq-dynamic-band-sample-processor',
      'Dynamic EQ settings are compiled by the sample processor; static response uses the resting band gain.',
      band.id,
      'info',
    ));
  }

  if (band.spectralDynamics?.enabled) {
    diagnostics.push(diagnostic(
      'audio-eq-spectral-dynamics-stft-processor',
      'Spectral Dynamics settings are compiled by the STFT sample processor; static response uses the resting band gain.',
      band.id,
      'info',
    ));
  }

  if (!isSupportedSlope(band.slopeDbPerOct)) {
    diagnostics.push(diagnostic(
      'audio-eq-slope-approximated',
      'Slope is outside the supported cascade range and will be clamped.',
      band.id,
    ));
  } else if (band.slopeDbPerOct !== undefined && Math.abs((band.slopeDbPerOct / 12) - Math.round(band.slopeDbPerOct / 12)) > 0.001) {
    diagnostics.push(diagnostic(
      'audio-eq-fractional-slope-approximated',
      'Fractional slopes are rendered with the nearest available biquad cascade.',
      band.id,
      'info',
    ));
  }

  return {
    band,
    coefficients: createAudioEqBiquadCascadeCoefficients(band, sampleRate),
  };
}

export function compileAudioEqPlan(
  params: AudioEqParamsV2 | unknown,
  options: { sampleRate?: number } = {},
): CompiledAudioEqPlan {
  const normalized = normalizeAudioEqParams(params);
  const sampleRate = options.sampleRate ?? AUDIO_EQ_DEFAULT_SAMPLE_RATE;
  const diagnostics: AudioEqCompilerDiagnostic[] = [];

  if (normalized.audible.phaseMode === 'linear') {
    diagnostics.push(diagnostic(
      'audio-eq-linear-phase-fir-processor',
      'Linear-phase EQ is rendered by the FFT/FIR sample processor and declares latency for render planning.',
      undefined,
      'info',
    ));
  } else if (normalized.audible.phaseMode === 'natural') {
    diagnostics.push(diagnostic(
      'audio-eq-natural-phase-iir-processor',
      'Natural phase renders through the zero-latency IIR compiler with analog-matching metadata preserved.',
      undefined,
      'info',
    ));
  }

  if (normalized.audible.characterMode !== 'clean') {
    diagnostics.push(diagnostic(
      'audio-eq-character-mode-sample-processor',
      'Character mode is compiled by the EQ sample processor after filter bands.',
      undefined,
      'info',
    ));
  }

  const bands = normalized.audible.bands
    .map(band => compileBand(band, sampleRate, diagnostics))
    .filter((band): band is CompiledAudioEqBandPlan => Boolean(band));

  return {
    sampleRate,
    phaseMode: normalized.audible.phaseMode,
    characterMode: normalized.audible.characterMode,
    latencySamples: normalized.audible.phaseMode === 'linear' ? AUDIO_EQ_LINEAR_PHASE_LATENCY_SAMPLES : 0,
    bands,
    diagnostics,
  };
}

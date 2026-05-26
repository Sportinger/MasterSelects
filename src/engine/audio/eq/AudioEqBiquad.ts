import type { AudioEqBand, AudioEqBiquadCoefficients } from './AudioEqTypes';

const MIN_FREQUENCY_HZ = 10;
const NYQUIST_MARGIN = 0.499;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeCoefficients(coefficients: AudioEqBiquadCoefficients): AudioEqBiquadCoefficients {
  if (!Number.isFinite(coefficients.a0) || Math.abs(coefficients.a0) < 1e-12) {
    return { b0: 1, b1: 0, b2: 0, a0: 1, a1: 0, a2: 0 };
  }

  const invA0 = 1 / coefficients.a0;
  return {
    b0: coefficients.b0 * invA0,
    b1: coefficients.b1 * invA0,
    b2: coefficients.b2 * invA0,
    a0: 1,
    a1: coefficients.a1 * invA0,
    a2: coefficients.a2 * invA0,
  };
}

function bandFrequencyRadians(frequencyHz: number, sampleRate: number): number {
  const nyquist = sampleRate / 2;
  const clamped = clamp(frequencyHz, MIN_FREQUENCY_HZ, Math.max(MIN_FREQUENCY_HZ, nyquist * NYQUIST_MARGIN));
  return 2 * Math.PI * (clamped / sampleRate);
}

function safeQ(q: number): number {
  return clamp(Number.isFinite(q) ? q : 1, 0.025, 100);
}

export function createAudioEqBiquadCoefficients(
  band: AudioEqBand,
  sampleRate: number,
): AudioEqBiquadCoefficients {
  const omega = bandFrequencyRadians(band.frequencyHz, sampleRate);
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const q = safeQ(band.q);
  const alpha = sin / (2 * q);
  const gain = Math.pow(10, band.gainDb / 40);
  const shelfSlope = 1;
  const shelfAlpha = sin / 2 * Math.sqrt((gain + 1 / gain) * (1 / shelfSlope - 1) + 2);

  switch (band.type) {
    case 'bell':
      return normalizeCoefficients({
        b0: 1 + alpha * gain,
        b1: -2 * cos,
        b2: 1 - alpha * gain,
        a0: 1 + alpha / gain,
        a1: -2 * cos,
        a2: 1 - alpha / gain,
      });

    case 'low-shelf':
      return normalizeCoefficients({
        b0: gain * ((gain + 1) - (gain - 1) * cos + 2 * Math.sqrt(gain) * shelfAlpha),
        b1: 2 * gain * ((gain - 1) - (gain + 1) * cos),
        b2: gain * ((gain + 1) - (gain - 1) * cos - 2 * Math.sqrt(gain) * shelfAlpha),
        a0: (gain + 1) + (gain - 1) * cos + 2 * Math.sqrt(gain) * shelfAlpha,
        a1: -2 * ((gain - 1) + (gain + 1) * cos),
        a2: (gain + 1) + (gain - 1) * cos - 2 * Math.sqrt(gain) * shelfAlpha,
      });

    case 'high-shelf':
      return normalizeCoefficients({
        b0: gain * ((gain + 1) + (gain - 1) * cos + 2 * Math.sqrt(gain) * shelfAlpha),
        b1: -2 * gain * ((gain - 1) + (gain + 1) * cos),
        b2: gain * ((gain + 1) + (gain - 1) * cos - 2 * Math.sqrt(gain) * shelfAlpha),
        a0: (gain + 1) - (gain - 1) * cos + 2 * Math.sqrt(gain) * shelfAlpha,
        a1: 2 * ((gain - 1) - (gain + 1) * cos),
        a2: (gain + 1) - (gain - 1) * cos - 2 * Math.sqrt(gain) * shelfAlpha,
      });

    case 'low-cut':
      return normalizeCoefficients({
        b0: (1 + cos) / 2,
        b1: -(1 + cos),
        b2: (1 + cos) / 2,
        a0: 1 + alpha,
        a1: -2 * cos,
        a2: 1 - alpha,
      });

    case 'high-cut':
      return normalizeCoefficients({
        b0: (1 - cos) / 2,
        b1: 1 - cos,
        b2: (1 - cos) / 2,
        a0: 1 + alpha,
        a1: -2 * cos,
        a2: 1 - alpha,
      });

    case 'notch':
      return normalizeCoefficients({
        b0: 1,
        b1: -2 * cos,
        b2: 1,
        a0: 1 + alpha,
        a1: -2 * cos,
        a2: 1 - alpha,
      });

    case 'band-pass':
      return normalizeCoefficients({
        b0: alpha,
        b1: 0,
        b2: -alpha,
        a0: 1 + alpha,
        a1: -2 * cos,
        a2: 1 - alpha,
      });

    case 'all-pass':
      return normalizeCoefficients({
        b0: 1 - alpha,
        b1: -2 * cos,
        b2: 1 + alpha,
        a0: 1 + alpha,
        a1: -2 * cos,
        a2: 1 - alpha,
      });

    case 'tilt-shelf':
      return createAudioEqBiquadCoefficients({ ...band, type: band.gainDb >= 0 ? 'high-shelf' : 'low-shelf' }, sampleRate);

    default:
      return { b0: 1, b1: 0, b2: 0, a0: 1, a1: 0, a2: 0 };
  }
}

function slopeStageCount(band: AudioEqBand): number {
  if (band.brickwall === true && (band.type === 'low-cut' || band.type === 'high-cut')) {
    return 8;
  }

  const slope = Number.isFinite(band.slopeDbPerOct) ? Math.abs(band.slopeDbPerOct ?? 12) : 12;
  if (
    band.type === 'low-cut' ||
    band.type === 'high-cut' ||
    band.type === 'low-shelf' ||
    band.type === 'high-shelf'
  ) {
    return clamp(Math.max(1, Math.round(slope / 12)), 1, 8);
  }

  return 1;
}

export function createAudioEqBiquadCascadeCoefficients(
  band: AudioEqBand,
  sampleRate: number,
): AudioEqBiquadCoefficients[] {
  const stages = slopeStageCount(band);
  if (stages <= 1) {
    return [createAudioEqBiquadCoefficients(band, sampleRate)];
  }

  if (band.type === 'low-shelf' || band.type === 'high-shelf' || band.type === 'tilt-shelf') {
    return Array.from({ length: stages }, () => createAudioEqBiquadCoefficients({
      ...band,
      gainDb: band.gainDb / stages,
    }, sampleRate));
  }

  return Array.from({ length: stages }, (_, index) => createAudioEqBiquadCoefficients({
    ...band,
    q: clamp(band.q * (1 + index * 0.06), 0.025, 100),
  }, sampleRate));
}

export function getBiquadMagnitudeAtFrequency(
  coefficients: AudioEqBiquadCoefficients,
  frequencyHz: number,
  sampleRate: number,
): number {
  const omega = bandFrequencyRadians(frequencyHz, sampleRate);
  const cos1 = Math.cos(omega);
  const sin1 = Math.sin(omega);
  const cos2 = Math.cos(2 * omega);
  const sin2 = Math.sin(2 * omega);

  const numeratorReal = coefficients.b0 + coefficients.b1 * cos1 + coefficients.b2 * cos2;
  const numeratorImag = -(coefficients.b1 * sin1 + coefficients.b2 * sin2);
  const denominatorReal = coefficients.a0 + coefficients.a1 * cos1 + coefficients.a2 * cos2;
  const denominatorImag = -(coefficients.a1 * sin1 + coefficients.a2 * sin2);
  const numerator = Math.hypot(numeratorReal, numeratorImag);
  const denominator = Math.max(1e-12, Math.hypot(denominatorReal, denominatorImag));
  return numerator / denominator;
}

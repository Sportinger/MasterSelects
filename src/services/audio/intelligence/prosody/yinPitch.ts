export interface YinPitchOptions {
  threshold?: number;
  minHz?: number;
  maxHz?: number;
}

export interface YinPitchResult {
  f0Hz: number;
  probability: number;
}

const DEFAULT_THRESHOLD = 0.15;
const DEFAULT_MIN_HZ = 60;
const DEFAULT_MAX_HZ = 450;

function unvoiced(): YinPitchResult {
  return { f0Hz: 0, probability: 0 };
}

/** Estimates one mono PCM frame's fundamental frequency using classic YIN. */
export function yinPitchFrame(
  frame: Float32Array,
  sampleRate: number,
  opts: YinPitchOptions = {},
): YinPitchResult {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || frame.length < 4) {
    return unvoiced();
  }

  const threshold = Number.isFinite(opts.threshold)
    ? Math.min(1, Math.max(0, opts.threshold ?? DEFAULT_THRESHOLD))
    : DEFAULT_THRESHOLD;
  const minHz = Number.isFinite(opts.minHz) && (opts.minHz ?? 0) > 0
    ? opts.minHz ?? DEFAULT_MIN_HZ
    : DEFAULT_MIN_HZ;
  const maxHz = Number.isFinite(opts.maxHz) && (opts.maxHz ?? 0) > minHz
    ? opts.maxHz ?? DEFAULT_MAX_HZ
    : DEFAULT_MAX_HZ;
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(frame.length - 2, Math.ceil(sampleRate / minHz));
  if (minLag > maxLag) return unvoiced();

  const difference = new Float64Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let index = 0; index < frame.length - lag; index += 1) {
      const delta = (frame[index] ?? 0) - (frame[index + lag] ?? 0);
      sum += delta * delta;
    }
    difference[lag] = sum;
  }

  const normalized = new Float64Array(maxLag + 1);
  normalized[0] = 1;
  let runningSum = 0;
  for (let lag = 1; lag <= maxLag; lag += 1) {
    runningSum += difference[lag] ?? 0;
    normalized[lag] = runningSum > 0
      ? (difference[lag] * lag) / runningSum
      : 1;
  }

  let selectedLag = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    if ((normalized[lag] ?? 1) >= threshold) continue;
    while (lag + 1 <= maxLag && (normalized[lag + 1] ?? 1) < (normalized[lag] ?? 1)) {
      lag += 1;
    }
    selectedLag = lag;
    break;
  }
  if (selectedLag === 0) return unvoiced();

  const center = normalized[selectedLag] ?? 1;
  const left = normalized[selectedLag - 1] ?? center;
  const right = normalized[selectedLag + 1] ?? center;
  const denominator = 2 * center - left - right;
  const adjustment = Math.abs(denominator) > 1e-12
    ? 0.5 * (right - left) / denominator
    : 0;
  const refinedLag = selectedLag + Math.max(-1, Math.min(1, adjustment));
  const f0Hz = sampleRate / refinedLag;
  if (!Number.isFinite(f0Hz) || f0Hz < minHz || f0Hz > maxHz) return unvoiced();

  return {
    f0Hz,
    probability: Math.max(0, Math.min(1, 1 - center)),
  };
}

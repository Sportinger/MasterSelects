function positiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function raisedCosine(value: number): number {
  const t = clamp01(value);
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

export function createStemSegmentStarts(
  totalSamples: number,
  segmentSamples: number,
  strideSamples: number,
): number[] {
  const total = Math.max(0, Math.floor(totalSamples));
  const segment = positiveInteger(segmentSamples, 1);
  const stride = Math.min(segment, positiveInteger(strideSamples, segment));

  if (total <= segment) {
    return [0];
  }

  const maxStart = total - segment;
  const starts: number[] = [];
  for (let start = 0; start < maxStart; start += stride) {
    starts.push(start);
  }

  if (starts[starts.length - 1] !== maxStart) {
    starts.push(maxStart);
  }

  return starts;
}

export function createStemOverlapWindow(
  segmentLength: number,
  previousOverlapSamples: number,
  nextOverlapSamples: number,
): Float32Array {
  const length = Math.max(0, Math.floor(segmentLength));
  const previousOverlap = Math.max(0, Math.min(length, Math.floor(previousOverlapSamples)));
  const nextOverlap = Math.max(0, Math.min(length, Math.floor(nextOverlapSamples)));
  const window = new Float32Array(length);

  for (let index = 0; index < length; index += 1) {
    let weight = 1;

    if (previousOverlap > 0 && index < previousOverlap) {
      weight = Math.min(weight, raisedCosine((index + 1) / previousOverlap));
    }

    if (nextOverlap > 0 && index >= length - nextOverlap) {
      weight = Math.min(weight, raisedCosine((length - index) / nextOverlap));
    }

    window[index] = weight;
  }

  return window;
}

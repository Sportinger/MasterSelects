import type {
  CameraSetupDescriptor,
  SetupClusteringThresholds,
  SetupDescriptorSignal,
  SetupFaceLayoutDescriptor,
} from '../../../../types/agentTimeline/setupDerivations';

export interface SetupDescriptorSimilarity {
  similarity: number;
  comparableWeight: number;
  signals: SetupDescriptorSignal[];
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function validHistogram(value: number[] | undefined, maximumBins: number): value is number[] {
  return Boolean(value
    && value.length > 0
    && value.length <= maximumBins
    && value.every((entry) => Number.isFinite(entry) && entry >= 0)
    && value.some((entry) => entry > 0));
}

function histogramSimilarity(left: number[], right: number[]): number | undefined {
  if (left.length !== right.length) return undefined;
  const leftTotal = left.reduce((sum, value) => sum + value, 0);
  const rightTotal = right.reduce((sum, value) => sum + value, 0);
  if (leftTotal <= 0 || rightTotal <= 0) return undefined;
  const distance = left.reduce((sum, value, index) => (
    sum + Math.abs(value / leftTotal - right[index] / rightTotal)
  ), 0);
  return clampUnit(1 - distance / 2);
}

function hashBits(value: string, maximumBits: number): string | undefined {
  const normalized = value.trim().toLowerCase();
  if (/^[01]+$/.test(normalized) && normalized.length <= maximumBits) return normalized;
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length * 4 > maximumBits) return undefined;
  return [...normalized].map((character) => (
    Number.parseInt(character, 16).toString(2).padStart(4, '0')
  )).join('');
}

function hashSimilarity(left: string | undefined, right: string | undefined, maximumBits: number): number | undefined {
  if (!left || !right) return undefined;
  const leftBits = hashBits(left, maximumBits);
  const rightBits = hashBits(right, maximumBits);
  if (!leftBits || !rightBits || leftBits.length !== rightBits.length) return undefined;
  let different = 0;
  for (let index = 0; index < leftBits.length; index += 1) {
    if (leftBits[index] !== rightBits[index]) different += 1;
  }
  return 1 - different / leftBits.length;
}

function validFaceLayout(value: SetupFaceLayoutDescriptor | undefined, maximumCenters: number): value is SetupFaceLayoutDescriptor {
  if (!value || !Number.isSafeInteger(value.faceCount) || value.faceCount < 0) return false;
  if (value.centers && (value.centers.length > maximumCenters || value.centers.some((center) => (
    !Number.isFinite(center.x) || !Number.isFinite(center.y)
    || center.x < 0 || center.x > 1 || center.y < 0 || center.y > 1
  )))) return false;
  return value.dominantFaceHeight === undefined
    || (Number.isFinite(value.dominantFaceHeight) && value.dominantFaceHeight >= 0 && value.dominantFaceHeight <= 1);
}

function faceLayoutSimilarity(left: SetupFaceLayoutDescriptor, right: SetupFaceLayoutDescriptor): number {
  const scores = [1 / (1 + Math.abs(left.faceCount - right.faceCount))];
  if (left.dominantFaceHeight !== undefined && right.dominantFaceHeight !== undefined) {
    scores.push(1 - Math.abs(left.dominantFaceHeight - right.dominantFaceHeight));
  }
  if (left.shotSize && right.shotSize && left.shotSize !== 'unknown' && right.shotSize !== 'unknown') {
    scores.push(left.shotSize === right.shotSize ? 1 : 0);
  }
  if (left.layout && right.layout && left.layout !== 'unknown' && right.layout !== 'unknown') {
    scores.push(left.layout === right.layout ? 1 : 0);
  }
  if (left.centers && right.centers && left.centers.length === right.centers.length && left.centers.length > 0) {
    const leftCenters = left.centers.toSorted((a, b) => a.x - b.x || a.y - b.y);
    const rightCenters = right.centers.toSorted((a, b) => a.x - b.x || a.y - b.y);
    const averageDistance = leftCenters.reduce((sum, center, index) => {
      const other = rightCenters[index];
      return sum + Math.hypot(center.x - other.x, center.y - other.y) / Math.SQRT2;
    }, 0) / leftCenters.length;
    scores.push(clampUnit(1 - averageDistance));
  }
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

export function descriptorSignals(
  descriptor: CameraSetupDescriptor | undefined,
  thresholds: SetupClusteringThresholds,
): SetupDescriptorSignal[] {
  if (!descriptor) return [];
  const signals: SetupDescriptorSignal[] = [];
  if (descriptor.perceptualHash && hashBits(descriptor.perceptualHash, thresholds.maximumHashBits)) signals.push('perceptual-hash');
  if (validHistogram(descriptor.colorHistogram, thresholds.maximumHistogramBins)) signals.push('color-histogram');
  if (validHistogram(descriptor.lumaHistogram, thresholds.maximumHistogramBins)) signals.push('luma-histogram');
  if (validHistogram(descriptor.edgeHistogram, thresholds.maximumHistogramBins)) signals.push('edge-histogram');
  if (validFaceLayout(descriptor.faceLayout, thresholds.maximumFaceCenters)) signals.push('face-layout');
  return signals;
}

export function descriptorAvailableWeight(
  descriptor: CameraSetupDescriptor | undefined,
  thresholds: SetupClusteringThresholds,
): number {
  return descriptorSignals(descriptor, thresholds).reduce((sum, signal) => {
    const key = signal === 'perceptual-hash' ? 'perceptualHash'
      : signal === 'color-histogram' ? 'colorHistogram'
        : signal === 'luma-histogram' ? 'lumaHistogram'
          : signal === 'edge-histogram' ? 'edgeHistogram'
            : 'faceLayout';
    return sum + thresholds.weights[key];
  }, 0);
}

export function compareSetupDescriptors(
  left: CameraSetupDescriptor,
  right: CameraSetupDescriptor,
  thresholds: SetupClusteringThresholds,
): SetupDescriptorSimilarity | undefined {
  const components: Array<{ score: number; weight: number; signal: SetupDescriptorSignal }> = [];
  const hash = hashSimilarity(left.perceptualHash, right.perceptualHash, thresholds.maximumHashBits);
  if (hash !== undefined) components.push({ score: hash, weight: thresholds.weights.perceptualHash, signal: 'perceptual-hash' });
  const color = validHistogram(left.colorHistogram, thresholds.maximumHistogramBins)
    && validHistogram(right.colorHistogram, thresholds.maximumHistogramBins)
    ? histogramSimilarity(left.colorHistogram, right.colorHistogram) : undefined;
  if (color !== undefined) components.push({ score: color, weight: thresholds.weights.colorHistogram, signal: 'color-histogram' });
  const luma = validHistogram(left.lumaHistogram, thresholds.maximumHistogramBins)
    && validHistogram(right.lumaHistogram, thresholds.maximumHistogramBins)
    ? histogramSimilarity(left.lumaHistogram, right.lumaHistogram) : undefined;
  if (luma !== undefined) components.push({ score: luma, weight: thresholds.weights.lumaHistogram, signal: 'luma-histogram' });
  const edge = validHistogram(left.edgeHistogram, thresholds.maximumHistogramBins)
    && validHistogram(right.edgeHistogram, thresholds.maximumHistogramBins)
    ? histogramSimilarity(left.edgeHistogram, right.edgeHistogram) : undefined;
  if (edge !== undefined) components.push({ score: edge, weight: thresholds.weights.edgeHistogram, signal: 'edge-histogram' });
  const faces = validFaceLayout(left.faceLayout, thresholds.maximumFaceCenters)
    && validFaceLayout(right.faceLayout, thresholds.maximumFaceCenters)
    ? faceLayoutSimilarity(left.faceLayout, right.faceLayout) : undefined;
  if (faces !== undefined) components.push({ score: faces, weight: thresholds.weights.faceLayout, signal: 'face-layout' });
  const comparableWeight = components.reduce((sum, component) => sum + component.weight, 0);
  if (comparableWeight < thresholds.minimumComparableWeight) return undefined;
  return {
    similarity: components.reduce((sum, component) => sum + component.score * component.weight, 0) / comparableWeight,
    comparableWeight,
    signals: components.map((component) => component.signal),
  };
}

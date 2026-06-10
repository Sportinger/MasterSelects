import {
  type FrequencyPhaseAnalysisContext,
  type NormalizedFrequencyPhaseParameters,
  type PhaseAnalysis,
} from './frequencyPhaseAnalysisTypes';
import {
  EPSILON,
  clamp,
  ratioToDb,
  safeSample,
} from './frequencyPhaseMath';

function phaseCorrelationForWindow(
  left: Float32Array,
  right: Float32Array,
  start: number,
  sampleCount: number,
): {
  correlation: number;
  midSideRatioDb: number;
  midPower: number;
  sidePower: number;
} {
  let sumLR = 0;
  let sumL2 = 0;
  let sumR2 = 0;
  let midPower = 0;
  let sidePower = 0;

  for (let offset = 0; offset < sampleCount; offset += 1) {
    const sampleIndex = start + offset;
    const leftSample = safeSample(left[sampleIndex] ?? 0);
    const rightSample = safeSample(right[sampleIndex] ?? 0);
    sumLR += leftSample * rightSample;
    sumL2 += leftSample * leftSample;
    sumR2 += rightSample * rightSample;

    const mid = (leftSample + rightSample) * 0.5;
    const side = (leftSample - rightSample) * 0.5;
    midPower += mid * mid;
    sidePower += side * side;
  }

  const denominator = Math.sqrt(sumL2 * sumR2);
  const silent = sumL2 <= EPSILON && sumR2 <= EPSILON;
  const correlation = silent
    ? 1
    : clamp(denominator > EPSILON ? sumLR / denominator : 0, -1, 1);

  return {
    correlation,
    midSideRatioDb: ratioToDb(midPower / Math.max(1, sampleCount), sidePower / Math.max(1, sampleCount)),
    midPower,
    sidePower,
  };
}

export function analyzePhaseCorrelation(
  buffer: AudioBuffer,
  parameters: NormalizedFrequencyPhaseParameters,
  context: FrequencyPhaseAnalysisContext,
  throwIfCancelled: (signal: AbortSignal | undefined, jobId: string) => void,
): PhaseAnalysis {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels >= 2 ? buffer.getChannelData(1) : left;
  const points = [];
  let correlationSum = 0;
  let minCorrelation = 1;
  let maxCorrelation = -1;
  let negativeCount = 0;
  let midSideSum = 0;
  let midPowerSum = 0;
  let sidePowerSum = 0;

  for (let pointIndex = 0; pointIndex < parameters.phasePointCount; pointIndex += 1) {
    if (pointIndex % 64 === 0) {
      context.onProgress?.({
        jobId: context.jobId,
        mediaFileId: context.mediaFileId,
        sourceFingerprint: context.sourceFingerprint,
        frequencyCacheKey: context.frequencyCacheKey,
        phaseCacheKey: context.phaseCacheKey,
        phase: 'analyzing-phase',
        percent: 52 + (pointIndex / parameters.phasePointCount) * 28,
        timestamp: new Date().toISOString(),
        frameIndex: pointIndex,
        frameCount: parameters.phasePointCount,
        message: 'Analyzing phase correlation',
      });
    }
    throwIfCancelled(context.signal, context.jobId);

    const start = pointIndex * parameters.phaseHopSamples;
    const availableSamples = Math.max(0, Math.min(parameters.phaseWindowSamples, buffer.length - start));
    const sampleCount = Math.max(1, availableSamples);
    const point = phaseCorrelationForWindow(left, right, start, sampleCount);
    const time = start / buffer.sampleRate;

    points.push({
      time,
      correlation: point.correlation,
      midSideRatioDb: point.midSideRatioDb,
    });
    correlationSum += point.correlation;
    minCorrelation = Math.min(minCorrelation, point.correlation);
    maxCorrelation = Math.max(maxCorrelation, point.correlation);
    if (point.correlation < 0) {
      negativeCount += 1;
    }
    midSideSum += point.midSideRatioDb;
    midPowerSum += point.midPower;
    sidePowerSum += point.sidePower;
  }

  const pointCount = Math.max(1, points.length);
  const negativeCorrelationPercent = negativeCount / pointCount;
  const stereoWidth = sidePowerSum / Math.max(EPSILON, midPowerSum + sidePowerSum);

  return {
    points,
    summary: {
      averageCorrelation: correlationSum / pointCount,
      minimumCorrelation: minCorrelation,
      maximumCorrelation: maxCorrelation,
      negativeCorrelationPercent,
      averageMidSideRatioDb: midSideSum / pointCount,
      stereoWidth: clamp(stereoWidth, 0, 1),
      monoCompatible: minCorrelation >= -0.25 && negativeCorrelationPercent <= 0.1,
    },
  };
}

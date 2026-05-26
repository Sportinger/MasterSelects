import type { AudioDynamicsReductionSnapshot, AudioMeterChannelSnapshot, AudioMeterSnapshot } from '../../types';

export const AUDIO_METER_FLOOR_DB = -120;
const AUDIO_METER_CLIP_THRESHOLD = 0.999;

export function audioMeterLinearToDb(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return AUDIO_METER_FLOOR_DB;
  return Math.max(AUDIO_METER_FLOOR_DB, 20 * Math.log10(value));
}

export function createSilentAudioMeterSnapshot(updatedAt: number): AudioMeterSnapshot {
  return {
    peakLinear: 0,
    rmsLinear: 0,
    peakDb: AUDIO_METER_FLOOR_DB,
    rmsDb: AUDIO_METER_FLOOR_DB,
    clipping: false,
    updatedAt,
  };
}

export interface AudioMeterStereoSamples {
  left: ArrayLike<number>;
  right: ArrayLike<number>;
}

function finiteSample(samples: ArrayLike<number>, index: number): number {
  const sample = samples[index];
  return Number.isFinite(sample) ? sample : 0;
}

function calculateAudioMeterChannelSnapshot(samples: ArrayLike<number>): AudioMeterChannelSnapshot {
  if (samples.length === 0) {
    return {
      peakLinear: 0,
      rmsLinear: 0,
      peakDb: AUDIO_METER_FLOOR_DB,
      rmsDb: AUDIO_METER_FLOOR_DB,
    };
  }

  let peakLinear = 0;
  let sumSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = finiteSample(samples, index);
    const abs = Math.abs(sample);
    peakLinear = Math.max(peakLinear, abs);
    sumSquares += sample * sample;
  }
  const rmsLinear = Math.sqrt(sumSquares / samples.length);
  return {
    peakLinear,
    rmsLinear,
    peakDb: audioMeterLinearToDb(peakLinear),
    rmsDb: audioMeterLinearToDb(rmsLinear),
  };
}

export function calculateStereoPhaseCorrelation(samples: AudioMeterStereoSamples): number | undefined {
  const length = Math.min(samples.left.length, samples.right.length);
  if (length === 0) return undefined;

  let cross = 0;
  let leftPower = 0;
  let rightPower = 0;

  for (let index = 0; index < length; index += 1) {
    const left = finiteSample(samples.left, index);
    const right = finiteSample(samples.right, index);
    cross += left * right;
    leftPower += left * left;
    rightPower += right * right;
  }

  const denominator = Math.sqrt(leftPower * rightPower);
  if (denominator <= 0.000000001) return 0;
  return Math.max(-1, Math.min(1, cross / denominator));
}

export function calculateStereoWidth(samples: AudioMeterStereoSamples): number | undefined {
  const length = Math.min(samples.left.length, samples.right.length);
  if (length === 0) return undefined;

  let midPower = 0;
  let sidePower = 0;

  for (let index = 0; index < length; index += 1) {
    const left = finiteSample(samples.left, index);
    const right = finiteSample(samples.right, index);
    const mid = (left + right) * 0.5;
    const side = (left - right) * 0.5;
    midPower += mid * mid;
    sidePower += side * side;
  }

  if (midPower <= 0.000000001 && sidePower <= 0.000000001) return 0;
  if (midPower <= 0.000000001) return 2;
  return Math.max(0, Math.min(2, Math.sqrt(sidePower / midPower)));
}

export function calculateAudioMeterSnapshot(
  samples: ArrayLike<number>,
  updatedAt: number,
  dynamics?: Record<string, AudioDynamicsReductionSnapshot>,
  stereoSamples?: AudioMeterStereoSamples,
  spectrumDb?: Float32Array,
): AudioMeterSnapshot {
  if (samples.length === 0) {
    return {
      ...createSilentAudioMeterSnapshot(updatedAt),
      ...(dynamics && Object.keys(dynamics).length > 0 ? { dynamics } : {}),
    };
  }

  let peakLinear = 0;
  let sumSquares = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Number.isFinite(samples[index]) ? samples[index] : 0;
    const abs = Math.abs(sample);
    if (abs > peakLinear) peakLinear = abs;
    sumSquares += sample * sample;
  }

  const rmsLinear = Math.sqrt(sumSquares / samples.length);
  const phaseCorrelation = stereoSamples ? calculateStereoPhaseCorrelation(stereoSamples) : undefined;
  const stereoWidth = stereoSamples ? calculateStereoWidth(stereoSamples) : undefined;
  const channels = stereoSamples
    ? {
        left: calculateAudioMeterChannelSnapshot(stereoSamples.left),
        right: calculateAudioMeterChannelSnapshot(stereoSamples.right),
      }
    : undefined;
  return {
    peakLinear,
    rmsLinear,
    peakDb: audioMeterLinearToDb(peakLinear),
    rmsDb: audioMeterLinearToDb(rmsLinear),
    clipping: peakLinear >= AUDIO_METER_CLIP_THRESHOLD,
    ...(channels ? { channels } : {}),
    ...(phaseCorrelation !== undefined ? { phaseCorrelation } : {}),
    ...(stereoWidth !== undefined ? { stereoWidth } : {}),
    ...(spectrumDb ? { spectrumDb } : {}),
    updatedAt,
    ...(dynamics && Object.keys(dynamics).length > 0 ? { dynamics } : {}),
  };
}

function aggregateDynamicsSnapshots(
  snapshots: readonly AudioMeterSnapshot[],
  updatedAt: number,
): Record<string, AudioDynamicsReductionSnapshot> | undefined {
  const dynamics: Record<string, AudioDynamicsReductionSnapshot> = {};

  for (const snapshot of snapshots) {
    for (const [effectId, reduction] of Object.entries(snapshot.dynamics ?? {})) {
      const current = dynamics[effectId];
      if (current && current.gainReductionDb >= reduction.gainReductionDb) continue;
      dynamics[effectId] = {
        ...reduction,
        updatedAt,
      };
    }
  }

  return Object.keys(dynamics).length > 0 ? dynamics : undefined;
}

export function aggregateAudioMeterSnapshots(
  snapshots: readonly AudioMeterSnapshot[],
  updatedAt: number,
): AudioMeterSnapshot {
  if (snapshots.length === 0) {
    return createSilentAudioMeterSnapshot(updatedAt);
  }

  let peakLinear = 0;
  let rmsPower = 0;
  let clipping = false;
  let phaseCorrelationSum = 0;
  let phaseCorrelationCount = 0;
  let stereoWidthSum = 0;
  let stereoWidthCount = 0;
  let leftPeakLinear = 0;
  let leftRmsPower = 0;
  let leftCount = 0;
  let rightPeakLinear = 0;
  let rightRmsPower = 0;
  let rightCount = 0;
  let spectrumSum: Float32Array | undefined;
  let spectrumCount = 0;

  for (const snapshot of snapshots) {
    peakLinear = Math.max(peakLinear, snapshot.peakLinear);
    rmsPower += snapshot.rmsLinear * snapshot.rmsLinear;
    clipping ||= snapshot.clipping;
    if (snapshot.phaseCorrelation !== undefined) {
      phaseCorrelationSum += snapshot.phaseCorrelation;
      phaseCorrelationCount += 1;
    }
    if (snapshot.stereoWidth !== undefined) {
      stereoWidthSum += snapshot.stereoWidth;
      stereoWidthCount += 1;
    }
    if (snapshot.channels) {
      leftPeakLinear = Math.max(leftPeakLinear, snapshot.channels.left.peakLinear);
      leftRmsPower += snapshot.channels.left.rmsLinear * snapshot.channels.left.rmsLinear;
      leftCount += 1;
      rightPeakLinear = Math.max(rightPeakLinear, snapshot.channels.right.peakLinear);
      rightRmsPower += snapshot.channels.right.rmsLinear * snapshot.channels.right.rmsLinear;
      rightCount += 1;
    }
    if (snapshot.spectrumDb && snapshot.spectrumDb.length > 0) {
      if (!spectrumSum || spectrumSum.length !== snapshot.spectrumDb.length) {
        spectrumSum = new Float32Array(snapshot.spectrumDb.length);
        spectrumCount = 0;
      }
      for (let index = 0; index < snapshot.spectrumDb.length; index += 1) {
        spectrumSum[index] += snapshot.spectrumDb[index];
      }
      spectrumCount += 1;
    }
  }

  const rmsLinear = Math.min(1, Math.sqrt(rmsPower));
  const dynamics = aggregateDynamicsSnapshots(snapshots, updatedAt);
  const spectrumDb = spectrumSum && spectrumCount > 0
    ? Float32Array.from(spectrumSum, value => value / spectrumCount)
    : undefined;
  const channels = leftCount > 0 && rightCount > 0
    ? {
        left: {
          peakLinear: leftPeakLinear,
          rmsLinear: Math.min(1, Math.sqrt(leftRmsPower)),
          peakDb: audioMeterLinearToDb(leftPeakLinear),
          rmsDb: audioMeterLinearToDb(Math.min(1, Math.sqrt(leftRmsPower))),
        },
        right: {
          peakLinear: rightPeakLinear,
          rmsLinear: Math.min(1, Math.sqrt(rightRmsPower)),
          peakDb: audioMeterLinearToDb(rightPeakLinear),
          rmsDb: audioMeterLinearToDb(Math.min(1, Math.sqrt(rightRmsPower))),
        },
      }
    : undefined;
  return {
    peakLinear,
    rmsLinear,
    peakDb: audioMeterLinearToDb(peakLinear),
    rmsDb: audioMeterLinearToDb(rmsLinear),
    clipping: clipping || peakLinear >= AUDIO_METER_CLIP_THRESHOLD,
    ...(channels ? { channels } : {}),
    ...(phaseCorrelationCount > 0 ? { phaseCorrelation: phaseCorrelationSum / phaseCorrelationCount } : {}),
    ...(stereoWidthCount > 0 ? { stereoWidth: stereoWidthSum / stereoWidthCount } : {}),
    ...(spectrumDb ? { spectrumDb } : {}),
    updatedAt,
    ...(dynamics ? { dynamics } : {}),
  };
}

export function audioMeterDbToUnit(db: number, floorDb = -60): number {
  if (!Number.isFinite(db) || db <= floorDb) return 0;
  if (db >= 0) return 1;
  return (db - floorDb) / Math.abs(floorDb);
}

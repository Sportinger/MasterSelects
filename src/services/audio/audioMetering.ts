import type { AudioDynamicsReductionSnapshot, AudioMeterSnapshot } from '../../types';

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

export function calculateAudioMeterSnapshot(
  samples: ArrayLike<number>,
  updatedAt: number,
  dynamics?: Record<string, AudioDynamicsReductionSnapshot>,
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
  return {
    peakLinear,
    rmsLinear,
    peakDb: audioMeterLinearToDb(peakLinear),
    rmsDb: audioMeterLinearToDb(rmsLinear),
    clipping: peakLinear >= AUDIO_METER_CLIP_THRESHOLD,
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

  for (const snapshot of snapshots) {
    peakLinear = Math.max(peakLinear, snapshot.peakLinear);
    rmsPower += snapshot.rmsLinear * snapshot.rmsLinear;
    clipping ||= snapshot.clipping;
  }

  const rmsLinear = Math.min(1, Math.sqrt(rmsPower));
  const dynamics = aggregateDynamicsSnapshots(snapshots, updatedAt);
  return {
    peakLinear,
    rmsLinear,
    peakDb: audioMeterLinearToDb(peakLinear),
    rmsDb: audioMeterLinearToDb(rmsLinear),
    clipping: clipping || peakLinear >= AUDIO_METER_CLIP_THRESHOLD,
    updatedAt,
    ...(dynamics ? { dynamics } : {}),
  };
}

export function audioMeterDbToUnit(db: number, floorDb = -60): number {
  if (!Number.isFinite(db) || db <= floorDb) return 0;
  if (db >= 0) return 1;
  return (db - floorDb) / Math.abs(floorDb);
}

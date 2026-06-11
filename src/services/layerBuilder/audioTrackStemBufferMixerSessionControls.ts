import type { TimelineClip } from '../../types';
import type { AudioMeterChannelSnapshot, AudioMeterSnapshot } from '../../types/audio';
import {
  aggregateAudioMeterSnapshots,
  audioMeterLinearToDb,
  calculateAudioMeterSnapshot,
} from '../audio/audioMetering';
import { runtimeAudioMeterBus } from '../audio/runtimeAudioMeterBus';
import { useTimelineStore } from '../../stores/timeline';
import { vfPipelineMonitor } from '../vfPipelineMonitor';
import { setMasterAudioClock } from './PlayheadState';
import {
  STEM_MIXER_METER_INTERVAL_MS,
  type StemBufferMixerLayer,
  type StemBufferMixerSession,
  type StemBufferMixerSyncOptions,
} from './audioTrackStemSyncModel';

type StemBufferMixerMeterEntry = {
  trackId: string;
  snapshot: AudioMeterSnapshot;
  masterSnapshot: AudioMeterSnapshot;
};

type StemBufferMixerPublishDebug = {
  at: number;
  sessionCount: number;
  entryCount: number;
  trackIds: string[];
  peaks: Array<{ trackId: string; peakLinear: number; rmsLinear: number }>;
};

const activeDebugSessions = new Set<StemBufferMixerSession>();
const stemBufferMixerDebugState: {
  starts: number;
  stops: number;
  lastSinglePublish: StemBufferMixerPublishDebug | null;
  lastBatchPublish: StemBufferMixerPublishDebug | null;
} = {
  starts: 0,
  stops: 0,
  lastSinglePublish: null,
  lastBatchPublish: null,
};

export function clampStemBufferMixerGain(value: number): number {
  return Math.max(0, Math.min(4, value));
}

export function recordStemBufferMixerSessionStart(session: StemBufferMixerSession): void {
  activeDebugSessions.add(session);
  stemBufferMixerDebugState.starts += 1;
}

export function recordStemBufferMixerSessionStop(session: StemBufferMixerSession): void {
  activeDebugSessions.delete(session);
  stemBufferMixerDebugState.stops += 1;
}

function getTimelineActions() {
  return useTimelineStore.getState();
}

function scaleMeterChannelForMaster(
  channel: AudioMeterChannelSnapshot,
  gain: number,
): AudioMeterChannelSnapshot {
  const peakLinear = channel.peakLinear * gain;
  const rmsLinear = channel.rmsLinear * gain;
  return {
    peakLinear,
    rmsLinear,
    peakDb: audioMeterLinearToDb(peakLinear),
    rmsDb: audioMeterLinearToDb(rmsLinear),
  };
}

function scaleMeterSnapshotForMaster(
  snapshot: AudioMeterSnapshot,
  gain: number,
): AudioMeterSnapshot {
  const peakLinear = snapshot.peakLinear * gain;
  const rmsLinear = snapshot.rmsLinear * gain;
  const channels = snapshot.channels
    ? {
        left: scaleMeterChannelForMaster(snapshot.channels.left, gain),
        right: scaleMeterChannelForMaster(snapshot.channels.right, gain),
      }
    : undefined;
  return {
    ...snapshot,
    peakLinear,
    rmsLinear,
    peakDb: audioMeterLinearToDb(peakLinear),
    rmsDb: audioMeterLinearToDb(rmsLinear),
    clipping: peakLinear >= 0.999,
    ...(channels ? { channels } : {}),
  };
}

export function updateStemBufferMixerGains(
  session: StemBufferMixerSession,
  layers: StemBufferMixerLayer[],
  masterVolume: number,
): void {
  const gainSignature = JSON.stringify({
    masterVolume: Math.round(masterVolume * 1000) / 1000,
    layers: layers.map(layer => [layer.id, Math.round(layer.gain * 1000) / 1000]),
  });
  if (session.lastGainSignature === gainSignature) return;
  session.lastGainSignature = gainSignature;

  const now = session.context.currentTime;
  session.masterGain.gain.setTargetAtTime(clampStemBufferMixerGain(masterVolume), now, 0.01);
  const targetGains = new Map(layers.map(layer => [layer.id, clampStemBufferMixerGain(layer.gain)]));
  for (const [layerId, gain] of session.gains) {
    gain.gain.setTargetAtTime(targetGains.get(layerId) ?? 0, now, 0.01);
  }
}

export function readStemBufferMixerMeter(
  session: StemBufferMixerSession,
  force = false,
  now = performance.now(),
): StemBufferMixerMeterEntry | null {
  if (!force && now - session.lastMeterPublishAt < STEM_MIXER_METER_INTERVAL_MS) return null;
  session.lastMeterPublishAt = now;
  session.analyser.getFloatTimeDomainData(session.meterSamples);
  const scope = { kind: 'track' as const, trackId: session.meterTrackId };
  const masterScope = { kind: 'master' as const };
  const includeStereo =
    runtimeAudioMeterBus.hasDemand(scope, 'stereo') ||
    runtimeAudioMeterBus.hasDemand(scope, 'phase') ||
    runtimeAudioMeterBus.hasDemand(masterScope, 'stereo') ||
    runtimeAudioMeterBus.hasDemand(masterScope, 'phase');
  if (includeStereo) {
    session.leftAnalyser.getFloatTimeDomainData(session.leftMeterSamples);
    session.rightAnalyser.getFloatTimeDomainData(session.rightMeterSamples);
  }
  const stereoSamples = includeStereo
    ? { left: session.leftMeterSamples, right: session.rightMeterSamples }
    : undefined;
  const snapshot = calculateAudioMeterSnapshot(session.meterSamples, now, undefined, stereoSamples);
  return {
    trackId: session.meterTrackId,
    snapshot,
    masterSnapshot: scaleMeterSnapshotForMaster(snapshot, clampStemBufferMixerGain(session.masterGain.gain.value)),
  };
}

export function publishStemBufferMixerMeter(session: StemBufferMixerSession, force = false): void {
  const entry = readStemBufferMixerMeter(session, force);
  if (!entry) return;
  stemBufferMixerDebugState.lastSinglePublish = {
    at: performance.now(),
    sessionCount: 1,
    entryCount: 1,
    trackIds: [entry.trackId],
    peaks: [{
      trackId: entry.trackId,
      peakLinear: entry.snapshot.peakLinear,
      rmsLinear: entry.snapshot.rmsLinear,
    }],
  };
  getTimelineActions().updateRuntimeAudioMeter(entry.trackId, entry.snapshot, entry.masterSnapshot);
}

export function publishStemBufferMixerMeters(sessions: Iterable<StemBufferMixerSession>): void {
  const sessionList = Array.from(sessions);
  const entries: StemBufferMixerMeterEntry[] = [];
  const now = performance.now();
  for (const session of sessionList) {
    const entry = readStemBufferMixerMeter(session, true, now);
    if (entry) entries.push(entry);
  }
  stemBufferMixerDebugState.lastBatchPublish = {
    at: now,
    sessionCount: sessionList.length,
    entryCount: entries.length,
    trackIds: entries.map(entry => entry.trackId),
    peaks: entries.map(entry => ({
      trackId: entry.trackId,
      peakLinear: entry.snapshot.peakLinear,
      rmsLinear: entry.snapshot.rmsLinear,
    })),
  };
  if (entries.length === 0) return;
  const masterSnapshot = aggregateAudioMeterSnapshots(entries.map(entry => entry.masterSnapshot), now);
  const trackEntries = entries.map(({ trackId, snapshot }) => ({ trackId, snapshot }));
  getTimelineActions().updateRuntimeAudioMeters(trackEntries, masterSnapshot);
}

export function getStemBufferMixerDebugSnapshot() {
  const now = performance.now();
  const sessions = Array.from(activeDebugSessions).map((session) => {
    let samplePeakLinear = 0;
    let sampleRmsLinear = 0;
    try {
      session.analyser.getFloatTimeDomainData(session.meterSamples);
      let sumSquares = 0;
      for (const sample of session.meterSamples) {
        const abs = Math.abs(sample);
        if (abs > samplePeakLinear) samplePeakLinear = abs;
        sumSquares += sample * sample;
      }
      sampleRmsLinear = Math.sqrt(sumSquares / Math.max(1, session.meterSamples.length));
    } catch {
      samplePeakLinear = -1;
      sampleRmsLinear = -1;
    }
    return {
      clipId: session.clipId,
      meterTrackId: session.meterTrackId,
      contextState: session.context.state,
      contextCurrentTime: Math.round(session.context.currentTime * 1000) / 1000,
      startedAtContextTime: Math.round(session.startedAtContextTime * 1000) / 1000,
      startedClipTime: Math.round(session.startedClipTime * 1000) / 1000,
      sourceTime: Math.round((session.getSourceTime() ?? -1) * 1000) / 1000,
      sourceCount: session.sourceCount,
      lastMeterAgeMs: Math.round(now - session.lastMeterPublishAt),
      samplePeakLinear: Math.round(samplePeakLinear * 100000) / 100000,
      sampleRmsLinear: Math.round(sampleRmsLinear * 100000) / 100000,
    };
  });
  return {
    starts: stemBufferMixerDebugState.starts,
    stops: stemBufferMixerDebugState.stops,
    activeSessionCount: sessions.length,
    sessions,
    lastSinglePublish: stemBufferMixerDebugState.lastSinglePublish,
    lastBatchPublish: stemBufferMixerDebugState.lastBatchPublish,
  };
}

export function setStemBufferMixerMasterClock(
  session: StemBufferMixerSession,
  clip: TimelineClip,
  timeInfo: StemBufferMixerSyncOptions['timeInfo'],
): void {
  setMasterAudioClock(session.getSourceTime, clip.startTime, clip.inPoint, timeInfo.absSpeed);
}

export function recordStemBufferMixerLifecycle(params: {
  action: 'restart' | 'start' | 'stop';
  clipId: string;
  driftMs?: number;
  sources: number;
}): void {
  vfPipelineMonitor.record('audio_stem_mixer', params);
}

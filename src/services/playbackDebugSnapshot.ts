import type { EngineStats } from '../types';
import { playbackHealthMonitor } from './playbackHealthMonitor';
import {
  buildPlaybackDebugStats,
  EFFECTIVE_PLAYBACK_CADENCE_WINDOW_MS,
  toPlaybackCadenceStats,
  type PlaybackCadenceStats,
  type PlaybackDebugStats,
  type PlaybackHealthAnomaly,
  type PlaybackHealthVideoState,
} from './playbackDebugStats';
import { wcPipelineMonitor } from './wcPipelineMonitor';
import { vfPipelineMonitor } from './vfPipelineMonitor';

const SNAPSHOT_THROTTLE_MS = 500;

let lastSnapshot: {
  capturedAt: number;
  decoder: EngineStats['decoder'];
  windowMs: number;
  stats: PlaybackDebugStats;
} | null = null;

export function getPlaybackDebugStats(
  decoder: EngineStats['decoder'],
  windowMs = 5000
): PlaybackDebugStats {
  const now = performance.now();

  if (
    lastSnapshot &&
    lastSnapshot.decoder === decoder &&
    lastSnapshot.windowMs === windowMs &&
    now - lastSnapshot.capturedAt < SNAPSHOT_THROTTLE_MS
  ) {
    return lastSnapshot.stats;
  }

  const stats = buildPlaybackDebugStats({
    decoder,
    now,
    windowMs,
    wcTimeline: wcPipelineMonitor.timeline(windowMs),
    vfTimeline: vfPipelineMonitor.timeline(windowMs),
    healthVideos: playbackHealthMonitor.videos() as PlaybackHealthVideoState[],
    healthAnomalies: playbackHealthMonitor.anomalies() as PlaybackHealthAnomaly[],
  });

  lastSnapshot = {
    capturedAt: now,
    decoder,
    windowMs,
    stats,
  };

  return stats;
}

export function getRecentPlaybackCadenceStats(
  decoder: EngineStats['decoder'],
): PlaybackCadenceStats {
  return toPlaybackCadenceStats(getPlaybackDebugStats(
    decoder,
    EFFECTIVE_PLAYBACK_CADENCE_WINDOW_MS,
  ));
}

import type { PlaybackDebugStats } from '../playbackDebugStats';

export function derivePlaybackStatus(
  stats: Omit<PlaybackDebugStats, 'status'>
): PlaybackDebugStats['status'] {
  const severeCadence = stats.p95FrameGapMs >= 85 || stats.maxFrameGapMs >= 140;
  const degradedCadence = stats.p95FrameGapMs >= 50 || stats.avgFrameGapMs >= 40;
  const noReadyFrames = stats.activeVideos > 0 && stats.worstReadyState > 0 && stats.worstReadyState < 2;
  const fallbackPreviewFrames = Object.entries(stats.previewPathCounts ?? {}).reduce(
    (count, [path, value]) =>
      path === 'proxy-frame' ||
      path === 'proxy-image-frame' ||
      path === 'proxy-image-frame-nearest' ||
      path === 'not-ready-scrub-cache' ||
      path === 'scrub-cache' ||
      path === 'gpu-cached' ||
      path === 'copied-preview'
        ? count + value
        : count,
    0
  );
  const responsivePreviewFallback =
    stats.playingVideos === 0 &&
    stats.previewFrames >= 3 &&
    stats.previewUpdates > 0 &&
    fallbackPreviewFrames >= Math.max(1, Math.floor(stats.previewFrames * 0.5)) &&
    stats.previewFreezeEvents === 0 &&
    stats.stalePreviewWhileTargetMoved <= 3 &&
    stats.maxPreviewUpdateGapMs <= 100;
  const hasLivePlaybackDemand =
    (stats.playingVideos ?? 0) > 0 ||
    stats.frameEvents > 0 ||
    stats.seeks > 0 ||
    stats.stalls > 0 ||
    stats.queuePressureEvents > 0 ||
    stats.seekingVideos > 0 ||
    stats.warmingUpVideos > 0;
  const coldPlayback =
    stats.coldVideos > 0 &&
    hasLivePlaybackDemand &&
    !responsivePreviewFallback;
  const healthIssuesDuringPlayback = stats.healthAnomalies > 0 && hasLivePlaybackDemand;
  const missingReadyFramesDuringPlayback =
    noReadyFrames &&
    hasLivePlaybackDemand &&
    !responsivePreviewFallback;
  const hasPreviewMotionDemand = stats.previewFrames > 0 && stats.stalePreviewWhileTargetMoved > 0;
  const previewFreezeDuringPlayback =
    stats.previewFreezeEvents > 0 &&
    stats.stalePreviewWhileTargetMoved > 0 &&
    (hasLivePlaybackDemand || hasPreviewMotionDemand);
  const severePreviewFreeze =
    previewFreezeDuringPlayback &&
    (stats.longestPreviewFreezeMs >= 650 || stats.stalePreviewWhileTargetMoved >= 12);

  if (
    stats.stalls > 0 ||
    severeCadence ||
    severePreviewFreeze ||
    healthIssuesDuringPlayback ||
    stats.readyStateDrops > 0 ||
    coldPlayback ||
    (stats.collectorDrops ?? 0) > 0 ||
    missingReadyFramesDuringPlayback
  ) {
    return 'bad';
  }

  if (
    degradedCadence ||
    stats.queuePressureEvents > 30 ||
    previewFreezeDuringPlayback ||
    stats.seeks >= 3 ||
    (stats.decoderResets ?? 0) >= 3 ||
    (stats.maxPendingSeekMs ?? 0) >= 80 ||
    stats.driftCorrections > 0 ||
    (!responsivePreviewFallback && stats.seekingVideos > 0) ||
    (!responsivePreviewFallback && stats.warmingUpVideos > 0)
  ) {
    return 'warn';
  }

  return 'ok';
}

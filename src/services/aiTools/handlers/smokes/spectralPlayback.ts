import { useTimelineStore } from '../../../../stores/timeline';
import type { ToolResult } from '../../types';
import { handleSimulatePlayback } from '../playback';
import { beginTimelineCanvasSmokeMutation, clampNumber, waitForFrames } from './smokeRuntime';
import { assertCanvasSmokeSnapshot, collectSmokeSnapshot } from './smokeSnapshots';

export async function handleRunTimelineCanvasSpectralPlaybackSmoke(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const timelineStore = useTimelineStore.getState();
  const previousAudioDisplayMode = timelineStore.audioDisplayMode;
  const previousWaveformsEnabled = timelineStore.waveformsEnabled;
  const requireAudioLike = args.requireAudioLike === true;
  const before = collectSmokeSnapshot('before');
  const failures: string[] = [];
  const endSmokeMutation = beginTimelineCanvasSmokeMutation();

  if (timelineStore.clips.length === 0) {
    failures.push('timeline has no clips for spectral playback smoke');
  }
  if (requireAudioLike && before.timeline.audioLikeClipCount === 0) {
    failures.push('timeline has no audio-like clip for spectral playback smoke');
  }

  let playbackResult: ToolResult | null = null;
  try {
    if (failures.length === 0) {
      timelineStore.setAudioDisplayMode('spectral');
      timelineStore.setWaveformsEnabled(true);
      await waitForFrames(3);
      playbackResult = await handleSimulatePlayback({
        startTime: clampNumber(args.startTime, 0, 0, Math.max(0, timelineStore.duration)),
        durationMs: clampNumber(args.durationMs, 1000, 250, 10000),
        settleMs: clampNumber(args.settleMs, 150, 0, 5000),
        resetDiagnostics: args.resetDiagnostics !== false,
      }, useTimelineStore.getState());
      if (!playbackResult.success) {
        failures.push(playbackResult.error ?? 'simulatePlayback failed');
      }
    }
  } finally {
    if (args.restoreAudioDisplayMode !== false) {
      useTimelineStore.getState().setAudioDisplayMode(previousAudioDisplayMode);
      useTimelineStore.getState().setWaveformsEnabled(previousWaveformsEnabled);
    }
    endSmokeMutation();
  }

  const after = collectSmokeSnapshot('after');
  failures.push(...assertCanvasSmokeSnapshot(after, {
    requireTimelineDom: args.requireTimelineDom === true,
  }));

  return {
    success: failures.length === 0,
    ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
    data: {
      before,
      after,
      playback: playbackResult,
      failures,
    },
  };
}
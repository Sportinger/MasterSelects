import {
  PREVIEW_FREEZE_RECOVERY_MS,
  PREVIEW_FREEZE_STALE_FRAMES,
  PREVIEW_FREEZE_WINDOW_MS,
  PLAYBACK_PURGE_COOLDOWN_MS,
} from './constants';
import type { AnomalyEvent, PlaybackHealthVideoSnapshot } from './contracts';
import {
  buildPlaybackDebugStats,
  type PlaybackHealthAnomaly,
} from '../playbackDebugStats';
import { vfPipelineMonitor } from '../vfPipelineMonitor';
import { wcPipelineMonitor } from '../wcPipelineMonitor';
import { isSlowCodecPlaybackProgressing } from '../mediaRuntime/codec/slowCodecPlayback';
import { Logger } from '../logger';

const log = Logger.create('PlaybackHealth');
let slowCodecFreezeNoted = false;

export interface PreviewFreezeRecovery {
  clipId?: string;
  detail: string;
}

export function classifyPreviewFreezeRecovery(params: {
  now: number;
  isPlaying: boolean;
  lastPlaybackPurgeAt: number;
  decoder: Parameters<typeof buildPlaybackDebugStats>[0]['decoder'];
  healthVideos: PlaybackHealthVideoSnapshot[];
  healthAnomalies: AnomalyEvent[];
}): PreviewFreezeRecovery | null {
  if (!params.isPlaying) return null;
  if (typeof document !== 'undefined' && document.hidden) return null;
  if (params.now - params.lastPlaybackPurgeAt < PLAYBACK_PURGE_COOLDOWN_MS) return null;
  if (params.healthVideos.length === 0) return null;
  // A decoder slower than real time still advances; a purge would only add a GOP re-decode.
  if (isSlowCodecPlaybackProgressing(params.now, PREVIEW_FREEZE_WINDOW_MS)) {
    if (!slowCodecFreezeNoted) log.info('Preview advances in steps: a codec decoder is slower than real time, freeze recovery skipped');
    slowCodecFreezeNoted = true;
    return null;
  }
  slowCodecFreezeNoted = false;

  const playback = buildPlaybackDebugStats({
    decoder: params.decoder,
    now: params.now,
    windowMs: PREVIEW_FREEZE_WINDOW_MS,
    wcTimeline: wcPipelineMonitor.timeline(PREVIEW_FREEZE_WINDOW_MS),
    vfTimeline: vfPipelineMonitor.timeline(PREVIEW_FREEZE_WINDOW_MS),
    healthVideos: params.healthVideos,
    healthAnomalies: params.healthAnomalies as PlaybackHealthAnomaly[],
  });

  const freezeLongEnough = playback.longestPreviewFreezeMs >= PREVIEW_FREEZE_RECOVERY_MS;
  const staleEnough = playback.stalePreviewWhileTargetMoved >= PREVIEW_FREEZE_STALE_FRAMES;
  if (!freezeLongEnough || !staleEnough) {
    return null;
  }

  return {
    clipId: playback.lastPreviewFreezeClipId,
    detail: [
      `preview frozen for ${Math.round(playback.longestPreviewFreezeMs)}ms`,
      `staleMovingFrames=${playback.stalePreviewWhileTargetMoved}`,
      `path=${playback.lastPreviewFreezePath ?? 'unknown'}`,
      `pipeline=${playback.pipeline}`,
    ].join(', '),
  };
}

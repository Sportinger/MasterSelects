import type { PipelineEvent } from '../wcPipelineMonitor';
import type { VFPipelineEvent } from '../vfPipelineMonitor';
import type {
  PlaybackRunDiagnostics,
  PlaybackRunDiagnosticsParams,
  PlaybackRunStartupStats,
} from '../playbackDebugStats';
import { buildPlaybackDebugStats } from './assembly';
import { filterEventsInRange, round } from './math';

function summarizeRunStartup(
  startMs: number,
  endMs: number,
  wcEvents: PipelineEvent[],
  vfEvents: VFPipelineEvent[]
): PlaybackRunStartupStats {
  const firstDecodeOutput = wcEvents.find((event) => event.type === 'decode_output');
  const previewEvents = vfEvents.filter((event) => event.type === 'vf_preview_frame');
  const firstPreviewFrame = previewEvents[0];
  const firstPreviewUpdate = previewEvents.find(
    (event) => event.detail?.changed === 'true'
  );

  let initialTargetMovedStaleFrames = 0;
  let initialTargetMovedStaleStartMs: number | null = null;

  for (const event of previewEvents) {
    const changed = event.detail?.changed === 'true';
    if (changed) {
      break;
    }
    if (event.detail?.targetMoved === 'true') {
      initialTargetMovedStaleFrames++;
      if (initialTargetMovedStaleStartMs === null) {
        initialTargetMovedStaleStartMs = event.t;
      }
    }
  }

  const firstPreviewUpdateMs =
    firstPreviewUpdate ? round(Math.max(0, firstPreviewUpdate.t - startMs), 1) : undefined;
  const startupCatchUpMs =
    initialTargetMovedStaleFrames > 0
      ? round(
        Math.max(
          0,
          (firstPreviewUpdate?.t ?? endMs) - startMs
        ),
        1
      )
      : undefined;
  const initialTargetMovedStaleMs =
    initialTargetMovedStaleFrames > 0 && initialTargetMovedStaleStartMs !== null
      ? round(
        Math.max(
          0,
          (firstPreviewUpdate?.t ?? endMs) - initialTargetMovedStaleStartMs
        ),
        1
      )
      : 0;

  return {
    firstDecodeOutputMs: firstDecodeOutput
      ? round(Math.max(0, firstDecodeOutput.t - startMs), 1)
      : undefined,
    firstPreviewFrameMs: firstPreviewFrame
      ? round(Math.max(0, firstPreviewFrame.t - startMs), 1)
      : undefined,
    firstPreviewUpdateMs,
    startupCatchUpMs,
    initialTargetMovedStaleFrames,
    initialTargetMovedStaleMs,
  };
}

export function buildPlaybackRunDiagnostics(
  params: PlaybackRunDiagnosticsParams
): PlaybackRunDiagnostics {
  const windowMs = Math.max(1, params.endMs - params.startMs);
  const wcEvents = filterEventsInRange(
    params.wcEvents ?? [],
    params.startMs,
    params.endMs
  );
  const vfEvents = filterEventsInRange(
    params.vfEvents ?? [],
    params.startMs,
    params.endMs
  );

  return {
    windowMs: round(windowMs, 1),
    playback: buildPlaybackDebugStats({
      decoder: params.decoder,
      now: params.endMs,
      windowMs,
      wcTimeline: wcEvents,
      vfTimeline: vfEvents,
      healthVideos: params.healthVideos,
      healthAnomalies: params.healthAnomalies,
    }),
    startup: summarizeRunStartup(params.startMs, params.endMs, wcEvents, vfEvents),
    wcEventCount: wcEvents.length,
    vfEventCount: vfEvents.length,
  };
}

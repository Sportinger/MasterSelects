import { useCallback, useRef } from 'react';
import { beginExportAnalytics, bucketTimelineDuration, bucketFps, bucketResolution, type AnalyticsExportRun } from '../../services/productAnalytics';
import type { useExportState } from './useExportState';

type ExportState = ReturnType<typeof useExportState>;

/** Record the synchronous runner callbacks, including the final callback before cancellation. */
export function useExportRunAnalytics(state: ExportState) {
  const activeAnalyticsRunRef = useRef<AnalyticsExportRun | null>(null);
  const startAnalyticsRun = useCallback((input: {
    container: string;
    encoder: string;
    endTime: number;
    fps: number;
    height: number;
    kind: 'audio' | 'fcpxml' | 'gif' | 'image_sequence' | 'still' | 'video';
    startTime: number;
    width: number;
  }) => {
    const run = beginExportAnalytics({
      container: input.container,
      duration_bucket: bucketTimelineDuration(Math.max(0, input.endTime - input.startTime)),
      encoder: input.encoder,
      fps_bucket: bucketFps(input.fps),
      kind: input.kind,
      resolution_bucket: bucketResolution(input.width, input.height),
    });
    activeAnalyticsRunRef.current = run;
    return run;
  }, []);

  const clearAnalyticsRun = useCallback((run: AnalyticsExportRun) => {
    if (activeAnalyticsRunRef.current?.id === run.id) {
      activeAnalyticsRunRef.current = null;
    }
  }, []);

  const { setProgress: updateProgress, setFfmpegProgress: updateFfmpegProgress, setExportPhase: updatePhase } = state;
  const setProgress = useCallback<ExportState['setProgress']>((value) => {
    if (value && typeof value !== 'function') activeAnalyticsRunRef.current?.trace?.stage(value.phase, value.percent);
    updateProgress(value);
  }, [updateProgress]);
  const setFfmpegProgress = useCallback<ExportState['setFfmpegProgress']>((value) => {
    if (value && typeof value !== 'function') activeAnalyticsRunRef.current?.trace?.stage('encoding', value.percent);
    updateFfmpegProgress(value);
  }, [updateFfmpegProgress]);
  const setExportPhase = useCallback<ExportState['setExportPhase']>((value) => {
    if (typeof value !== 'function' && value !== 'idle') activeAnalyticsRunRef.current?.trace?.stage(value);
    updatePhase(value);
  }, [updatePhase]);
  return { activeAnalyticsRunRef, startAnalyticsRun, clearAnalyticsRun, setProgress, setFfmpegProgress, setExportPhase };
}
